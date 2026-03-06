import type { Logger } from '@cadre-dev/framework/core';
import type { PlatformProvider, PullRequestMergeMethod } from '../../platform/provider.js';

/** Maximum merge + resolve attempts when encountering dirty state. */
export const MERGE_MAX_ATTEMPTS = 3;

/** Base delay (ms) after a branch update before retrying merge. Doubled per attempt for exponential backoff. */
export const MERGE_BASE_DELAY_MS = 15_000;

/** Maximum time (ms) to poll GitHub for mergeable state to settle after a push. */
const MERGEABLE_POLL_TIMEOUT_MS = 90_000;

/** Interval (ms) between mergeable-state polls. */
const MERGEABLE_POLL_INTERVAL_MS = 10_000;

/** Context passed to each merge attempt for logging and identification. */
export interface MergeAttemptContext {
  prNumber: number;
  prUrl?: string;
  branch?: string;
  issueNumber: number;
}

/**
 * Optional callback invoked when a server-side branch update alone cannot
 * resolve a dirty merge state.  Typically launches a conflict-resolver agent.
 *
 * Should return `true` if the conflict was resolved (the caller will retry
 * the merge after a backoff delay).
 */
export type ConflictResolverCallback = (
  ctx: MergeAttemptContext,
  errorDetails: string,
) => Promise<boolean>;

export interface MergeRetryOptions {
  /** Maximum attempts (defaults to {@link MERGE_MAX_ATTEMPTS}). */
  maxAttempts?: number;
  /** Base backoff delay in ms (defaults to {@link MERGE_BASE_DELAY_MS}). */
  baseDelayMs?: number;
  /** Merge method to use (defaults to platform default). */
  mergeMethod?: PullRequestMergeMethod;
  /** Optional agent-based fallback when updateBranch alone does not suffice. */
  conflictResolver?: ConflictResolverCallback;
  /** Timeout (ms) for polling mergeable state after conflict resolution push.
   *  Set to 0 to skip polling entirely. Defaults to {@link MERGEABLE_POLL_TIMEOUT_MS}. */
  mergeablePollTimeoutMs?: number;
}

/**
 * Shared merge-with-retry logic used by both {@link FleetScheduler} (DAG auto-merge)
 * and {@link PullRequestCompletionQueue} (pre-existing PR completion).
 *
 * Strategy per attempt:
 * 1. `mergePullRequest()`
 * 2. On dirty state → `updatePullRequestBranch()` (fast, server-side)
 * 3. If updateBranch fails and a `conflictResolver` is provided → invoke it
 * 4. Exponential backoff before next attempt
 */
export class MergeRetryHelper {
  constructor(
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly baseBranch: string,
  ) {}

  /**
   * Attempt to merge a PR, retrying on dirty state with branch updates
   * and optional conflict resolution.
   *
   * @returns `true` if the merge succeeded, `false` if all attempts were exhausted.
   */
  async mergeWithRetry(
    ctx: MergeAttemptContext,
    opts: MergeRetryOptions = {},
  ): Promise<boolean> {
    const maxAttempts = opts.maxAttempts ?? MERGE_MAX_ATTEMPTS;
    const baseDelayMs = opts.baseDelayMs ?? MERGE_BASE_DELAY_MS;
    const mergeablePollTimeoutMs = opts.mergeablePollTimeoutMs ?? MERGEABLE_POLL_TIMEOUT_MS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.platform.mergePullRequest(ctx.prNumber, this.baseBranch, opts.mergeMethod);
        return true;
      } catch (err) {
        const error = String(err);
        const isDirty = isMergeConflict(error);

        if (isDirty && attempt < maxAttempts) {
          this.logger.info(
            `PR #${ctx.prNumber} merge blocked (dirty); requesting branch update (attempt ${attempt}/${maxAttempts})`,
            { issueNumber: ctx.issueNumber, data: { prUrl: ctx.prUrl, branch: ctx.branch } },
          );

          const updated = await this.platform.updatePullRequestBranch(ctx.prNumber).catch(() => false);
          if (updated) {
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            this.logger.info(
              `Branch update requested for PR #${ctx.prNumber}; waiting ${delay / 1000}s before retry`,
              { issueNumber: ctx.issueNumber },
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          // Server-side update didn't help — try the conflict resolver callback if provided.
          if (opts.conflictResolver) {
            try {
              const resolved = await opts.conflictResolver(ctx, error);
              if (resolved) {
                // After a conflict-resolver push, poll GitHub until mergeable_state
                // settles (typically 30-60s after force-push).  This avoids wasting
                // a retry attempt on stale dirty state.
                await this.waitForMergeableState(ctx, mergeablePollTimeoutMs);
                continue;
              }
            } catch (resolveErr) {
              this.logger.warn(
                `Conflict resolver failed for PR #${ctx.prNumber}: ${String(resolveErr)}`,
                { issueNumber: ctx.issueNumber },
              );
            }
          }
        }

        // Final attempt failed, non-dirty error, or no resolution path — give up.
        this.logger.warn(
          `Failed to merge PR #${ctx.prNumber} for issue #${ctx.issueNumber}: ${error}`,
          { issueNumber: ctx.issueNumber, data: { prUrl: ctx.prUrl, branch: ctx.branch } },
        );
        return false;
      }
    }
    return false;
  }

  /**
   * Poll the PR's mergeable_state until it's no longer 'unknown' or until
   * the timeout expires.  After a force-push, GitHub takes 30-60s to
   * recalculate merge status.  Polling avoids wasting an attempt on stale
   * dirty state.
   */
  private async waitForMergeableState(ctx: MergeAttemptContext, timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return;
    const deadline = Date.now() + timeoutMs;
    // Initial wait — GitHub needs a few seconds after push to even start recalculating
    await new Promise((r) => setTimeout(r, MERGEABLE_POLL_INTERVAL_MS));

    while (Date.now() < deadline) {
      try {
        const pr = await this.platform.getPullRequest(ctx.prNumber);
        const state = pr.mergeableState ?? 'unknown';
        if (state !== 'unknown') {
          this.logger.info(
            `PR #${ctx.prNumber} mergeable state settled: ${state}`,
            { issueNumber: ctx.issueNumber },
          );
          return;
        }
      } catch {
        // Ignore transient API errors during polling
      }
      await new Promise((r) => setTimeout(r, MERGEABLE_POLL_INTERVAL_MS));
    }

    this.logger.info(
      `PR #${ctx.prNumber} mergeable state poll timed out after ${timeoutMs / 1000}s; proceeding with merge attempt`,
      { issueNumber: ctx.issueNumber },
    );
  }
}

/**
 * Detect whether an error message indicates a merge-conflict / dirty-state failure.
 * Exported for reuse in tests.
 */
export function isMergeConflict(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('mergeable_state=dirty')
    || lower.includes('has merge conflicts')
    || lower.includes('merge conflicts')
  );
}
