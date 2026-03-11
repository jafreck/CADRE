import type { Logger } from '@cadre-dev/framework/core';
import type { PlatformProvider, PullRequestMergeMethod } from '../../platform/provider.js';
import { MergeRetryHelper, MERGE_MAX_ATTEMPTS, MERGE_BASE_DELAY_MS, type ConflictResolverCallback, type MergeAttemptContext } from './merge-retry.js';

interface QueueItem {
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  dependencyIssueNumbers: number[];
}

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
const MAX_MERGE_RESOLUTION_ATTEMPTS = MERGE_MAX_ATTEMPTS;

/** Base delay (ms) after pushing conflict resolution before retrying merge. Multiplied by attempt number for exponential backoff. */
const BASE_POST_RESOLVE_DELAY_MS = MERGE_BASE_DELAY_MS;

type DependencySatisfiedFn = (dependencyIssueNumber: number) => boolean | Promise<boolean>;

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
  private readonly mergeRetry: MergeRetryHelper;

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
  ) {
    this.mergeRetry = new MergeRetryHelper(platform, logger, baseBranch);
  }

  enqueue(item: QueueItem): void {
    if (!this.enabled) return;
    if (this.queued.has(item.prNumber)) return;
    this.queued.add(item.prNumber);
    this.items.push(item);

    this.logger.info(
      `Queued PR #${item.prNumber} for auto-completion`,
      {
        workItemId: String(item.issueNumber),
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

  getCompletedIssueNumbers(): ReadonlySet<number> {
    return this.completedIssueNumbers;
  }

  /**
   * Check whether a specific issue has been completed within this queue's
   * drain cycle.  Used by the isDependencySatisfied callback to see intra-drain
   * completions that haven't yet been promoted in the fleet checkpoint.
   */
  isIssueCompleted(issueNumber: number): boolean {
    return this.completedIssueNumbers.has(issueNumber);
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

    // Attempt merge via shared retry helper
    const resolver = this.conflictResolver;
    const conflictResolverCb: ConflictResolverCallback | undefined = resolver
      ? async (ctx: MergeAttemptContext, errorDetails: string) => resolver(item, errorDetails)
      : undefined;

    const merged = await this.mergeRetry.mergeWithRetry(
      {
        prNumber: item.prNumber,
        prUrl: item.prUrl,
        branch: item.branch,
        issueNumber: item.issueNumber,
      },
      {
        maxAttempts: this.conflictResolver ? MAX_MERGE_RESOLUTION_ATTEMPTS : 1,
        baseDelayMs: this.basePostResolveDelayMs,
        mergeMethod: this.mergeMethod,
        conflictResolver: conflictResolverCb,
        // When basePostResolveDelayMs is 0 (tests), skip polling too.
        mergeablePollTimeoutMs: this.basePostResolveDelayMs === 0 ? 0 : undefined,
      },
    );

    if (merged) {
      this.completedIssueNumbers.add(item.issueNumber);
      this.logger.info(
        `Auto-completed PR #${item.prNumber} into ${this.baseBranch} using ${this.mergeMethod} merge`,
        {
          workItemId: String(item.issueNumber),
          data: { prUrl: item.prUrl, branch: item.branch },
        },
      );
    } else {
      this.failedIssueNumbers.add(item.issueNumber);
      this.failures.push({ ...item, error: `Merge failed after retries for PR #${item.prNumber}` });
      this.logger.warn(
        `Auto-complete failed for PR #${item.prNumber}`,
        {
          workItemId: String(item.issueNumber),
          data: { prUrl: item.prUrl, branch: item.branch },
        },
      );
    }
  }

  private recordDependencyBlockedFailure(item: QueueItem, dependencyIssueNumber: number): void {
    const error = `Blocked by unresolved dependency issue #${dependencyIssueNumber}`;
    this.failedIssueNumbers.add(item.issueNumber);
    this.failures.push({ ...item, error });
    this.logger.warn(
      `Skipping auto-complete for existing PR #${item.prNumber}: ${error}`,
      {
        workItemId: String(item.issueNumber),
        data: { prUrl: item.prUrl, branch: item.branch },
      },
    );
  }
}
