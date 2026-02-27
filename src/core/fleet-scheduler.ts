import pLimit from 'p-limit';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { IssueResult } from './issue-orchestrator.js';
import type { IssueDag } from './issue-dag.js';
import type { FleetCheckpointManager } from './checkpoint.js';
import type { PlatformProvider } from '../platform/provider.js';
import type { RuntimeConfig } from '../config/loader.js';
import { Logger } from '../logging/logger.js';

/** Callback type for processing a single issue. */
export type ProcessIssueFn = (issue: IssueDetail, dag?: IssueDag) => Promise<IssueResult>;

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
    dag?: IssueDag,
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
    dag: IssueDag,
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
    dag: IssueDag,
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
          try {
            await this.platform.mergePullRequest(result.pr.number, this.config.baseBranch);
          } catch (err) {
            this.logger.warn(
              `Failed to merge PR #${result.pr.number} for issue #${num}: ${err}`,
              { issueNumber: num },
            );
            await this.fleetCheckpoint.setIssueStatus(
              num,
              'dep-merge-conflict',
              '',
              '',
              0,
              issue.title,
              String(err),
            );
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
}
