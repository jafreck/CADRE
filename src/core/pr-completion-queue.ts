import type { Logger } from '@cadre/framework/core';
import type { PlatformProvider, PullRequestMergeMethod } from '../platform/provider.js';

interface QueueItem {
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  dependencyIssueNumbers: number[];
}

type DependencySatisfiedFn = (dependencyIssueNumber: number) => boolean | Promise<boolean>;

/**
 * Callback invoked when a PR merge fails due to conflicts (dirty state).
 * Should attempt to resolve the conflicts and return `true` if resolved.
 */
export type MergeConflictResolverFn = (
  item: QueueItem,
  errorDetails: string,
) => Promise<boolean>;

export interface CompletionFailure {
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  error: string;
}

/** Maximum merge + resolve attempts per PR when a conflict resolver is provided. */
const MAX_MERGE_RESOLUTION_ATTEMPTS = 3;

/** Base delay (ms) after pushing conflict resolution before retrying merge. Multiplied by attempt number for exponential backoff. */
const BASE_POST_RESOLVE_DELAY_MS = 15_000;

/** Delay (ms) after pre-drain branch updates to let GitHub propagate mergeable state. */
const PRE_DRAIN_SETTLE_MS = 20_000;

/**
 * Dedicated subsystem that queues and processes PR auto-completion work.
 *
 * This lets FleetOrchestrator enqueue many existing open PRs (e.g. on resume)
 * without blocking per-issue scheduling, while still awaiting completion before
 * final fleet reporting.
 *
 * Merges are always **serial** because each merge into the base branch changes
 * it, and subsequent PRs need the updated base to avoid cascading conflicts.
 * Items are processed in enqueue order, respecting DAG dependencies.
 */
export class PullRequestCompletionQueue {
  private readonly items: QueueItem[] = [];
  private readonly queued = new Set<number>();
  private readonly completedIssueNumbers = new Set<number>();
  private readonly failedIssueNumbers = new Set<number>();
  private readonly failures: CompletionFailure[] = [];

  constructor(
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly baseBranch: string,
    private readonly mergeMethod: PullRequestMergeMethod,
    private readonly enabled: boolean,
    private readonly isDependencySatisfied: DependencySatisfiedFn,
    private readonly conflictResolver?: MergeConflictResolverFn,
    private readonly basePostResolveDelayMs: number = BASE_POST_RESOLVE_DELAY_MS,
    private readonly preDrainSettleMs: number = PRE_DRAIN_SETTLE_MS,
  ) {}

  enqueue(item: QueueItem): void {
    if (!this.enabled) return;
    if (this.queued.has(item.prNumber)) return;
    this.queued.add(item.prNumber);
    this.items.push(item);

    this.logger.info(
      `Queued PR #${item.prNumber} for auto-completion`,
      {
        issueNumber: item.issueNumber,
        data: {
          prUrl: item.prUrl,
          branch: item.branch,
          mergeMethod: this.mergeMethod,
        },
      },
    );
  }

  /**
   * Process all queued items sequentially. Respects DAG dependencies:
   * an item whose dependency failed is marked dep-blocked and skipped.
   * Idempotent — already-processed items are skipped on subsequent calls.
   *
   * Fix 8: Before serial merges, request server-side branch updates for all
   * queued PRs in parallel to minimize dirty-state conflicts.
   */
  async drain(): Promise<void> {
    const pendingItems = this.items.filter(
      (item) => !this.completedIssueNumbers.has(item.issueNumber) && !this.failedIssueNumbers.has(item.issueNumber),
    );

    if (pendingItems.length === 0) return;

    // Fix 8: Pre-drain branch update — request server-side updates for all queued PRs.
    const updatePromises = pendingItems.map((item) =>
      this.platform.updatePullRequestBranch(item.prNumber).catch(() => false),
    );
    const updateResults = await Promise.all(updatePromises);
    const updatedCount = updateResults.filter(Boolean).length;

    if (updatedCount > 0) {
      this.logger.info(
        `Pre-drain: requested branch updates for ${updatedCount}/${pendingItems.length} PRs; waiting ${this.preDrainSettleMs / 1000}s for propagation`,
      );
      await new Promise((r) => setTimeout(r, this.preDrainSettleMs));
    }

    for (const item of this.items) {
      if (this.completedIssueNumbers.has(item.issueNumber) || this.failedIssueNumbers.has(item.issueNumber)) {
        continue;
      }
      await this.executeItem(item);
    }
  }

  getQueuedCount(): number {
    return this.queued.size;
  }

  getFailures(): CompletionFailure[] {
    return [...this.failures];
  }

  private async executeItem(item: QueueItem): Promise<void> {
    // Check all dependencies first
    for (const depIssueNumber of item.dependencyIssueNumbers) {
      // If dep was queued and failed, block this item
      if (this.failedIssueNumbers.has(depIssueNumber)) {
        this.recordDependencyBlockedFailure(item, depIssueNumber);
        return;
      }

      // If dep was not queued (handled elsewhere), check external status
      if (!this.completedIssueNumbers.has(depIssueNumber) && !this.queued.has(depIssueNumber)) {
        const satisfied = await this.isDependencySatisfied(depIssueNumber);
        if (!satisfied) {
          this.recordDependencyBlockedFailure(item, depIssueNumber);
          return;
        }
      }
    }

    // Attempt merge with conflict resolution retry loop
    const maxAttempts = this.conflictResolver ? MAX_MERGE_RESOLUTION_ATTEMPTS : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.platform.mergePullRequest(item.prNumber, this.baseBranch, this.mergeMethod);
        this.completedIssueNumbers.add(item.issueNumber);
        this.logger.info(
          `Auto-completed PR #${item.prNumber} into ${this.baseBranch} using ${this.mergeMethod} merge`,
          {
            issueNumber: item.issueNumber,
            data: { prUrl: item.prUrl, branch: item.branch },
          },
        );
        return;
      } catch (err) {
        const error = String(err);
        const isDirty = this.isMergeConflict(error);

        if (isDirty && attempt < maxAttempts) {
          // Fix 5: Try server-side branch update first — faster and more reliable than agent.
          this.logger.info(
            `PR #${item.prNumber} merge blocked (dirty); trying updateBranch first (attempt ${attempt}/${maxAttempts})`,
            {
              issueNumber: item.issueNumber,
              data: { prUrl: item.prUrl, branch: item.branch },
            },
          );

          const updated = await this.platform.updatePullRequestBranch(item.prNumber).catch(() => false);
          if (updated) {
            // Fix 6: Exponential backoff — 15s, 30s, 60s.
            const delay = this.basePostResolveDelayMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          // Server-side update didn't help — try the conflict resolver agent.
          if (this.conflictResolver) {
            try {
              const resolved = await this.conflictResolver(item, error);
              if (resolved) {
                // Fix 6: Exponential backoff.
                const delay = this.basePostResolveDelayMs * Math.pow(2, attempt - 1);
                await new Promise((r) => setTimeout(r, delay));
                continue;
              }
            } catch (resolveErr) {
              this.logger.warn(
                `Conflict resolver failed for PR #${item.prNumber}: ${String(resolveErr)}`,
                { issueNumber: item.issueNumber },
              );
            }
          }
        }

        this.failedIssueNumbers.add(item.issueNumber);
        this.failures.push({ ...item, error });
        this.logger.warn(
          `Auto-complete failed for PR #${item.prNumber}: ${error}`,
          {
            issueNumber: item.issueNumber,
            data: { prUrl: item.prUrl, branch: item.branch },
          },
        );
        return;
      }
    }
  }

  private isMergeConflict(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('mergeable_state=dirty')
      || lower.includes('has merge conflicts')
      || lower.includes('merge conflicts')
    );
  }

  private recordDependencyBlockedFailure(item: QueueItem, dependencyIssueNumber: number): void {
    const error = `Blocked by unresolved dependency issue #${dependencyIssueNumber}`;
    this.failedIssueNumbers.add(item.issueNumber);
    this.failures.push({ ...item, error });
    this.logger.warn(
      `Skipping auto-complete for existing PR #${item.prNumber}: ${error}`,
      {
        issueNumber: item.issueNumber,
        data: { prUrl: item.prUrl, branch: item.branch },
      },
    );
  }
}
