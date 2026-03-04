import type { Logger } from '@cadre/framework/core';
import type { PlatformProvider, PullRequestMergeMethod } from '../platform/provider.js';

/** Maximum merge + resolve attempts when encountering dirty state. */
export const MERGE_MAX_ATTEMPTS = 3;

/** Base delay (ms) after a branch update before retrying merge. Doubled per attempt for exponential backoff. */
export const MERGE_BASE_DELAY_MS = 15_000;

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
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise((r) => setTimeout(r, delay));
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
