import pLimit from 'p-limit';
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
const MAX_MERGE_RESOLUTION_ATTEMPTS = 2;

/**
 * Dedicated subsystem that queues and processes PR auto-completion work.
 *
 * This lets FleetOrchestrator enqueue many existing open PRs (e.g. on resume)
 * without blocking per-issue scheduling, while still awaiting completion before
 * final fleet reporting.
 */
export class PullRequestCompletionQueue {
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly tasks: Array<Promise<void>> = [];
  private readonly queued = new Set<number>();
  private readonly itemsByIssueNumber = new Map<number, QueueItem>();
  private readonly executionByIssueNumber = new Map<number, Promise<void>>();
  private readonly failedIssueNumbers = new Set<number>();
  private readonly failures: CompletionFailure[] = [];

  constructor(
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly baseBranch: string,
    private readonly mergeMethod: PullRequestMergeMethod,
    private readonly enabled: boolean,
    private readonly isDependencySatisfied: DependencySatisfiedFn,
    concurrency: number,
    private readonly conflictResolver?: MergeConflictResolverFn,
  ) {
    this.limit = pLimit(Math.max(1, concurrency));
  }

  enqueue(item: QueueItem): void {
    if (!this.enabled) return;
    if (this.queued.has(item.prNumber)) return;
    this.queued.add(item.prNumber);
    this.itemsByIssueNumber.set(item.issueNumber, item);

    this.logger.info(
      `Queued existing open PR #${item.prNumber} for auto-completion`,
      {
        issueNumber: item.issueNumber,
        data: {
          prUrl: item.prUrl,
          branch: item.branch,
          mergeMethod: this.mergeMethod,
        },
      },
    );

    this.tasks.push(this.ensureExecution(item.issueNumber));
  }

  async drain(): Promise<void> {
    for (const issueNumber of this.itemsByIssueNumber.keys()) {
      this.ensureExecution(issueNumber);
    }
    await Promise.all(this.tasks);
  }

  getQueuedCount(): number {
    return this.queued.size;
  }

  getFailures(): CompletionFailure[] {
    return [...this.failures];
  }

  private ensureExecution(issueNumber: number): Promise<void> {
    const existing = this.executionByIssueNumber.get(issueNumber);
    if (existing) return existing;

    const task = this.executeItem(issueNumber);
    this.executionByIssueNumber.set(issueNumber, task);
    return task;
  }

  private async executeItem(issueNumber: number): Promise<void> {
    const item = this.itemsByIssueNumber.get(issueNumber);
    if (!item) return;

    for (const dependencyIssueNumber of item.dependencyIssueNumbers) {
      if (this.itemsByIssueNumber.has(dependencyIssueNumber)) {
        await this.ensureExecution(dependencyIssueNumber);
        if (this.failedIssueNumbers.has(dependencyIssueNumber)) {
          this.recordDependencyBlockedFailure(item, dependencyIssueNumber);
          return;
        }
        continue;
      }

      const satisfied = await this.isDependencySatisfied(dependencyIssueNumber);
      if (!satisfied) {
        this.recordDependencyBlockedFailure(item, dependencyIssueNumber);
        return;
      }
    }

    await this.limit(async () => {
      const maxAttempts = this.conflictResolver ? MAX_MERGE_RESOLUTION_ATTEMPTS : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.platform.mergePullRequest(item.prNumber, this.baseBranch, this.mergeMethod);
          this.logger.info(
            `Auto-completed existing PR #${item.prNumber} into ${this.baseBranch} using ${this.mergeMethod} merge`,
            {
              issueNumber: item.issueNumber,
              data: { prUrl: item.prUrl, branch: item.branch },
            },
          );
          return;
        } catch (err) {
          const error = String(err);
          const isDirty = this.isMergeConflict(error);

          if (isDirty && this.conflictResolver && attempt < maxAttempts) {
            this.logger.info(
              `PR #${item.prNumber} merge blocked (dirty); launching auto-resolution (attempt ${attempt}/${maxAttempts})`,
              {
                issueNumber: item.issueNumber,
                data: { prUrl: item.prUrl, branch: item.branch },
              },
            );

            try {
              const resolved = await this.conflictResolver(item, error);
              if (resolved) continue;
            } catch (resolveErr) {
              this.logger.warn(
                `Conflict resolver failed for PR #${item.prNumber}: ${String(resolveErr)}`,
                { issueNumber: item.issueNumber },
              );
            }
          }

          this.failedIssueNumbers.add(item.issueNumber);
          this.failures.push({ ...item, error });
          this.logger.warn(
            `Auto-complete failed for existing PR #${item.prNumber}: ${error}`,
            {
              issueNumber: item.issueNumber,
              data: { prUrl: item.prUrl, branch: item.branch },
            },
          );
          return;
        }
      }
    });
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
