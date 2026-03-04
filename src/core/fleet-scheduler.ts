import pLimit from 'p-limit';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { IssueResult } from './issue-orchestrator.js';
import type { WorkItemDag, FleetCheckpointManager } from '@cadre/framework/engine';
import type { PlatformProvider } from '../platform/provider.js';
import type { RuntimeConfig } from '../config/loader.js';
import { Logger } from '@cadre/framework/core';

/** Maximum merge + retry attempts for DAG auto-merge when encountering dirty state. */
const DAG_MERGE_MAX_ATTEMPTS = 3;

/** Base delay (ms) after requesting a branch update before retrying merge. Doubled per attempt. */
const DAG_MERGE_BASE_DELAY_MS = 15_000;

/** Callback type for processing a single issue. */
export type ProcessIssueFn = (issue: IssueDetail, dag?: WorkItemDag<IssueDetail>) => Promise<IssueResult>;

/** Callback type for marking an issue as dep-blocked. */
export type MarkDepBlockedFn = (issue: IssueDetail) => Promise<IssueResult>;

/**
 * Handles bounded-parallelism and DAG wave scheduling for fleet issue pipelines.
 */
export class FleetScheduler {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly issues: IssueDetail[],
    private readonly fleetCheckpoint: FleetCheckpointManager,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly dagDepMap?: Record<number, number[]>,
  ) {}

  /**
   * Schedule issue pipelines with either simple bounded parallelism or DAG ordering.
   */
  async schedule(
    issuesToProcess: IssueDetail[],
    processIssue: ProcessIssueFn,
    markDepBlocked: MarkDepBlockedFn,
    dag?: WorkItemDag<IssueDetail>,
  ): Promise<PromiseSettledResult<IssueResult>[]> {
    if (dag) {
      return this.runWithDag(dag, processIssue, markDepBlocked);
    }

    const limit = pLimit(this.config.options.maxParallelIssues);
    return Promise.allSettled(
      issuesToProcess.map((issue) =>
        limit(() => processIssue(issue)),
      ),
    );
  }

  /**
   * Execute all issues wave-by-wave when a DAG is present.
   */
  private async runWithDag(
    dag: WorkItemDag<IssueDetail>,
    processIssue: ProcessIssueFn,
    markDepBlocked: MarkDepBlockedFn,
  ): Promise<PromiseSettledResult<IssueResult>[]> {
    const waves = dag.getWaves();
    const waveNumbers = waves.map((w) => w.map((i) => i.number));
    this.logger.info(
      `DAG plan: ${waveNumbers.map((w, i) => `Wave ${i} → [${w.map((n) => `#${n}`).join(', ')}]`).join(' | ')}`,
    );
    await this.fleetCheckpoint.setDag(this.dagDepMap ?? {}, waveNumbers);

    // --- Per-dependency scheduling ---
    const allIssues = new Map(this.issues.map((i) => [i.number, i]));
    const completed = new Set<number>();
    const failed = new Set<number>();
    const inFlight = new Set<number>();
    const blocked = new Set<number>();

    const allResults: PromiseSettledResult<IssueResult>[] = [];
    const limit = pLimit(this.config.options.maxParallelIssues);

    // On resume, treat already-completed issues as done
    if (this.config.options.resume) {
      for (const issue of this.issues) {
        if (this.fleetCheckpoint.isIssueCompleted(issue.number)) {
          completed.add(issue.number);
          this.logger.info(`Resume: issue #${issue.number} already completed`, { issueNumber: issue.number });
        }
      }
    }

    const depsReady = (issueNumber: number): boolean => {
      const deps = dag.getDirectDeps(issueNumber);
      return deps.every((d) => completed.has(d));
    };

    const depsFailed = (issueNumber: number): boolean => {
      const deps = dag.getDirectDeps(issueNumber);
      return deps.some((d) => failed.has(d) || blocked.has(d));
    };

    const scheduleReady = (): void => {
      for (const [num, issue] of allIssues) {
        if (completed.has(num) || failed.has(num) || blocked.has(num) || inFlight.has(num)) continue;

        if (depsFailed(num)) {
          blocked.add(num);
          const blockPromise = markDepBlocked(issue).then((result) => {
            allResults.push({ status: 'fulfilled', value: result });
            scheduleReady();
          });
          blockPromise.catch(() => {});
          continue;
        }

        if (depsReady(num)) {
          inFlight.add(num);
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          limit(() => this.runDagIssue(num, issue, dag, processIssue, completed, failed, blocked, allResults, limit, scheduleReady));
        }
      }
    };

    scheduleReady();

    await new Promise<void>((resolve) => {
      const check = (): void => {
        const settled = completed.size + failed.size + blocked.size;
        if (settled >= allIssues.size) {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });

    return allResults;
  }

  /**
   * Run a single DAG issue, then autoMerge if applicable, then notify the scheduler.
   */
  private async runDagIssue(
    num: number,
    issue: IssueDetail,
    dag: WorkItemDag<IssueDetail>,
    processIssue: ProcessIssueFn,
    completed: Set<number>,
    failed: Set<number>,
    blocked: Set<number>,
    allResults: PromiseSettledResult<IssueResult>[],
    _limit: ReturnType<typeof pLimit>,
    scheduleReady: () => void,
  ): Promise<void> {
    try {
      const result = await processIssue(issue, dag);
      allResults.push({ status: 'fulfilled', value: result });

      const depFailureStatuses = new Set(['dep-failed', 'dep-merge-conflict', 'dep-build-broken']);
      const cpStatus = this.fleetCheckpoint.getIssueStatus(num);
      const isFailure = !result.success || (cpStatus && depFailureStatuses.has(cpStatus.status));

      if (isFailure) {
        failed.add(num);
      } else {
        if (this.config.dag?.autoMerge && result.success && result.pr) {
          const merged = await this.tryMergeWithRetry(result.pr, num, issue.title);
          if (!merged) {
            failed.add(num);
            scheduleReady();
            return;
          }
        }
        completed.add(num);
      }
    } catch (err) {
      allResults.push({ status: 'rejected', reason: err });
      failed.add(num);
    }
    scheduleReady();
  }

  /**
   * Attempt to merge a PR with retries, using server-side branch update +
   * exponential backoff when the PR has merge conflicts (dirty state).
   *
   * Mirrors the retry strategy used in PullRequestCompletionQueue.drain()
   * so that DAG auto-merge gets the same conflict-resolution treatment.
   */
  private async tryMergeWithRetry(
    pr: PullRequestInfo,
    issueNumber: number,
    issueTitle: string,
  ): Promise<boolean> {
    const maxAttempts = DAG_MERGE_MAX_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.platform.mergePullRequest(pr.number, this.config.baseBranch);
        return true;
      } catch (err) {
        const error = String(err);
        const isDirty = error.toLowerCase().includes('mergeable_state=dirty')
          || error.toLowerCase().includes('merge conflicts');

        if (isDirty && attempt < maxAttempts) {
          this.logger.info(
            `PR #${pr.number} merge blocked (dirty); requesting branch update (attempt ${attempt}/${maxAttempts})`,
            { issueNumber, data: { prUrl: pr.url, branch: pr.headBranch } },
          );

          const updated = await this.platform.updatePullRequestBranch(pr.number).catch(() => false);
          if (updated) {
            const delay = DAG_MERGE_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            this.logger.info(
              `Branch update requested for PR #${pr.number}; waiting ${delay / 1000}s before retry`,
              { issueNumber },
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }

        // Final attempt failed or non-dirty error — record failure
        this.logger.warn(
          `Failed to merge PR #${pr.number} for issue #${issueNumber}: ${err}`,
          { issueNumber },
        );
        await this.fleetCheckpoint.setIssueStatus(
          issueNumber,
          'dep-merge-conflict',
          '',
          '',
          0,
          issueTitle,
          String(err),
        );
        return false;
      }
    }
    return false;
  }
}
