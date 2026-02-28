import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { IssueResult } from './issue-orchestrator.js';
import type { FleetCheckpointManager } from './checkpoint.js';
import type { TokenTracker } from '../budget/token-tracker.js';
import { FleetProgressWriter, type IssueProgressInfo, type PullRequestRef } from './progress.js';
import { getPhaseCount } from './phase-registry.js';
import { ReportWriter } from '../reporting/report-writer.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { Logger } from '../logging/logger.js';
import type { FleetResult } from './fleet-orchestrator.js';

/**
 * Encapsulates result aggregation, progress-file writing, and run-report generation.
 */
export class FleetReporter {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly issues: IssueDetail[],
    private readonly fleetCheckpoint: FleetCheckpointManager,
    private readonly fleetProgress: FleetProgressWriter,
    private readonly tokenTracker: TokenTracker,
    private readonly logger: Logger,
  ) {}

  /**
   * Aggregate results from all issue pipelines.
   */
  aggregateResults(
    results: PromiseSettledResult<IssueResult>[],
    startTime: number,
  ): FleetResult {
    const issueResults: IssueResult[] = [];
    const prsCreated: PullRequestInfo[] = [];
    const failedIssues: Array<{ issueNumber: number; error: string }> = [];
    const codeDoneNoPR: Array<{ issueNumber: number; branch: string }> = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        issueResults.push(result.value);

        if (result.value.pr) {
          prsCreated.push(result.value.pr);
        }

        if (!result.value.success) {
          failedIssues.push({
            issueNumber: result.value.issueNumber,
            error: result.value.error ?? 'Unknown error',
          });
        }

        if (result.value.codeComplete && !result.value.success) {
          const checkpointStatus = this.fleetCheckpoint.getIssueStatus(result.value.issueNumber);
          codeDoneNoPR.push({
            issueNumber: result.value.issueNumber,
            branch: checkpointStatus?.branchName ?? '',
          });
        }
      } else {
        failedIssues.push({
          issueNumber: 0,
          error: String(result.reason),
        });
      }
    }

    const success = failedIssues.length === 0;

    return {
      success,
      issues: issueResults,
      prsCreated,
      failedIssues,
      codeDoneNoPR,
      totalDuration: Date.now() - startTime,
      tokenUsage: this.tokenTracker.getSummary(),
    };
  }

  /**
   * Write fleet progress markdown.
   */
  async writeFleetProgress(result: FleetResult): Promise<void> {
    const issueInfos: IssueProgressInfo[] = this.issues.map((issue) => {
      const ir = result.issues.find((r) => r.issueNumber === issue.number);
      const status = this.fleetCheckpoint.getIssueStatus(issue.number);
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: status?.status ?? 'not-started',
        currentPhase: status?.lastPhase ?? 0,
        totalPhases: getPhaseCount(),
        prNumber: ir?.pr?.number,
        branch: status?.branchName,
        error: ir?.error,
      };
    });

    const prRefs: PullRequestRef[] = result.issues
      .filter((ir) => ir.pr != null)
      .map((ir) => ({
        issueNumber: ir.issueNumber,
        prNumber: ir.pr!.number,
        url: ir.pr!.url,
      }));

    await this.fleetProgress.write(issueInfos, prRefs, {
      current: this.tokenTracker.getTotal(),
      budget: this.config.options.tokenBudget,
    });
  }

  /**
   * Write incremental progress update (during processing).
   */
  async writeFleetProgressIncremental(): Promise<void> {
    const issueInfos: IssueProgressInfo[] = this.issues.map((issue) => {
      const status = this.fleetCheckpoint.getIssueStatus(issue.number);
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: status?.status ?? 'not-started',
        currentPhase: status?.lastPhase ?? 0,
        totalPhases: getPhaseCount(),
        branch: status?.branchName,
      };
    });

    await this.fleetProgress.write(issueInfos, [], {
      current: this.tokenTracker.getTotal(),
      budget: this.config.options.tokenBudget,
    });
  }

  /**
   * Write the run report using ReportWriter.
   */
  async writeReport(fleetResult: FleetResult, startTime: number): Promise<void> {
    try {
      const reportWriter = new ReportWriter(this.config, new CostEstimator(this.config.agent.copilot));
      const report = reportWriter.buildReport(fleetResult, this.issues, startTime);
      const reportPath = await reportWriter.write(report);
      this.logger.info(`Run report written: ${reportPath}`);
    } catch (err) {
      this.logger.warn(`Failed to write run report: ${err}`);
    }
  }
}
