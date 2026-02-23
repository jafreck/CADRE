import { join } from 'node:path';
import pLimit from 'p-limit';
import type { CadreConfig } from '../config/schema.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager, FleetCheckpointManager } from './checkpoint.js';
import { FleetProgressWriter, type IssueProgressInfo, type PullRequestRef } from './progress.js';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { TokenTracker, type TokenSummary } from '../budget/token-tracker.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { Logger } from '../logging/logger.js';
import { getPhaseCount } from './phase-registry.js';
import { ReportWriter } from '../reporting/report-writer.js';
import { NotificationManager } from '../notifications/manager.js';

export interface FleetResult {
  /** Whether all issues were resolved successfully. */
  success: boolean;
  /** Per-issue outcomes. */
  issues: IssueResult[];
  /** Issues that completed and had PRs opened. */
  prsCreated: PullRequestInfo[];
  /** Issues that failed or were blocked. */
  failedIssues: Array<{ issueNumber: number; error: string }>;
  /** Total duration across all pipelines. */
  totalDuration: number;
  /** Aggregate token usage. */
  tokenUsage: TokenSummary;
}

/**
 * Manages all issue pipelines running in parallel.
 */
export class FleetOrchestrator {
  private readonly cadreDir: string;
  private readonly fleetCheckpoint: FleetCheckpointManager;
  private readonly fleetProgress: FleetProgressWriter;
  private readonly tokenTracker: TokenTracker;
  private readonly costEstimator: CostEstimator;
  private fleetBudgetExceeded = false;

  constructor(
    private readonly config: CadreConfig,
    private readonly issues: IssueDetail[],
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager = new NotificationManager(),
  ) {
    this.cadreDir = join(config.repoPath, '.cadre');
    this.fleetCheckpoint = new FleetCheckpointManager(this.cadreDir, config.projectName, logger);
    this.fleetProgress = new FleetProgressWriter(this.cadreDir, logger);
    this.tokenTracker = new TokenTracker();
    this.costEstimator = new CostEstimator(config.copilot);
  }

  /**
   * Execute all issue pipelines with bounded parallelism.
   */
  async run(): Promise<FleetResult> {
    const startTime = Date.now();

    // Load fleet checkpoint
    await this.fleetCheckpoint.load();

    this.logger.info(`Fleet starting: ${this.issues.length} issues, max ${this.config.options.maxParallelIssues} parallel`);
    await this.fleetProgress.appendEvent(
      `Fleet started: ${this.issues.length} issues`,
    );
    await this.notifications.dispatch({
      type: 'fleet-started',
      issueCount: this.issues.length,
      maxParallel: this.config.options.maxParallelIssues,
    });

    // Filter out already completed issues on resume
    const issuesToProcess = this.config.options.resume
      ? this.issues.filter((issue) => !this.fleetCheckpoint.isIssueCompleted(issue.number))
      : this.issues;

    if (issuesToProcess.length < this.issues.length) {
      const skipped = this.issues.length - issuesToProcess.length;
      this.logger.info(`Resume: skipping ${skipped} already-completed issues`);
    }

    // Run with bounded parallelism
    const limit = pLimit(this.config.options.maxParallelIssues);
    const results = await Promise.allSettled(
      issuesToProcess.map((issue) =>
        limit(() => this.processIssue(issue)),
      ),
    );

    // Aggregate results
    const fleetResult = this.aggregateResults(results, startTime);

    // Write run report
    try {
      const reportWriter = new ReportWriter(this.config, new CostEstimator(this.config.copilot));
      const report = reportWriter.buildReport(fleetResult, this.issues, startTime);
      const reportPath = await reportWriter.write(report);
      this.logger.info(`Run report written: ${reportPath}`);
    } catch (err) {
      this.logger.warn(`Failed to write run report: ${err}`);
    }

    // Write final progress
    await this.writeFleetProgress(fleetResult);
    await this.fleetProgress.appendEvent(
      `Fleet completed: ${fleetResult.prsCreated.length} PRs, ${fleetResult.failedIssues.length} failures`,
    );
    await this.notifications.dispatch({
      type: 'fleet-completed',
      success: fleetResult.success,
      prsCreated: fleetResult.prsCreated.length,
      failedIssues: fleetResult.failedIssues.length,
      totalDuration: fleetResult.totalDuration,
      totalTokens: fleetResult.tokenUsage.total,
    });

    return fleetResult;
  }

  /**
   * Process a single issue through its full pipeline.
   */
  private async processIssue(issue: IssueDetail): Promise<IssueResult> {
    // Abort early if fleet budget was already exceeded by a completed issue
    if (this.fleetBudgetExceeded) {
      this.logger.warn(`Skipping issue #${issue.number}: fleet budget exceeded`, {
        issueNumber: issue.number,
      });
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'budget-exceeded',
        '',
        '',
        0,
        'Fleet budget exceeded',
      );
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
        prCreated: false,
        budgetExceeded: true,
        phases: [],
        totalDuration: 0,
        tokenUsage: 0,
        error: 'Fleet budget exceeded',
      };
    }

    this.logger.info(`Processing issue #${issue.number}: ${issue.title}`, {
      issueNumber: issue.number,
    });

    try {
      // 1. Provision worktree
      const worktree = await this.worktreeManager.provision(
        issue.number,
        issue.title,
      );

      // 2. Update fleet checkpoint
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'in-progress',
        worktree.path,
        worktree.branch,
        0,
      );

      // 3. Set up per-issue progress directory
      const progressDir = join(
        worktree.path,
        '.cadre',
        'issues',
        String(issue.number),
      );

      // 4. Create per-issue checkpoint manager
      const checkpoint = new CheckpointManager(progressDir, this.logger);
      await checkpoint.load(String(issue.number));
      await checkpoint.setWorktreeInfo(
        worktree.path,
        worktree.branch,
        worktree.baseCommit,
      );

      // 5. Create per-issue orchestrator
      const issueOrchestrator = new IssueOrchestrator(
        this.config,
        issue,
        worktree,
        checkpoint,
        this.launcher,
        this.platform,
        this.logger.child(issue.number, join(this.cadreDir, 'logs')),
      );

      // 6. Run the 5-phase pipeline
      const result = await issueOrchestrator.run();

      // 7. Update fleet checkpoint
      const status = result.budgetExceeded
        ? 'budget-exceeded'
        : result.success
          ? 'completed'
          : 'failed';
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        status,
        worktree.path,
        worktree.branch,
        result.phases.length,
        result.error,
      );

      // 8. Record token usage
      if (result.tokenUsage !== null) {
        this.tokenTracker.record(issue.number, 'total', 0, result.tokenUsage);
        await this.fleetCheckpoint.recordTokenUsage(issue.number, result.tokenUsage);
      }

      // 9. Check budget
      const budgetStatus = this.tokenTracker.checkFleetBudget(
        this.config.options.tokenBudget,
      );
      if (budgetStatus === 'exceeded') {
        this.fleetBudgetExceeded = true;
        this.logger.error('Fleet token budget exceeded — pausing', {
          data: {
            current: this.tokenTracker.getTotal(),
            budget: this.config.options.tokenBudget,
          },
        });
        await this.notifications.dispatch({
          type: 'budget-exceeded',
          scope: 'fleet',
          currentUsage: this.tokenTracker.getTotal(),
          budget: this.config.options.tokenBudget ?? 0,
        });
      } else if (budgetStatus === 'warning') {
        const current = this.tokenTracker.getTotal();
        const budget = this.config.options.tokenBudget ?? 0;
        await this.notifications.dispatch({
          type: 'budget-warning',
          scope: 'fleet',
          currentUsage: current,
          budget,
          percentUsed: budget > 0 ? Math.round((current / budget) * 100) : 0,
        });
      }

      // Update progress
      await this.writeFleetProgressIncremental();

      return result;
    } catch (err) {
      const error = String(err);
      this.logger.error(`Issue #${issue.number} failed: ${error}`, {
        issueNumber: issue.number,
      });

      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'failed',
        '',
        '',
        0,
        error,
      );

      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
        prCreated: false,
        phases: [],
        totalDuration: 0,
        tokenUsage: 0,
        error,
      };
    }
  }

  /**
   * Aggregate results from all issue pipelines.
   */
  private aggregateResults(
    results: PromiseSettledResult<IssueResult>[],
    startTime: number,
  ): FleetResult {
    const issueResults: IssueResult[] = [];
    const prsCreated: PullRequestInfo[] = [];
    const failedIssues: Array<{ issueNumber: number; error: string }> = [];

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
      } else {
        // Shouldn't happen since we catch errors in processIssue, but just in case
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
      totalDuration: Date.now() - startTime,
      tokenUsage: this.tokenTracker.getSummary(),
    };
  }

  /**
   * Write fleet progress markdown.
   */
  private async writeFleetProgress(result: FleetResult): Promise<void> {
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
        error: ir?.error,
      };
    });

    const prRefs: PullRequestRef[] = result.prsCreated.map((pr) => ({
      issueNumber: 0, // We'd need to track this mapping
      prNumber: pr.number,
      url: pr.url,
    }));

    await this.fleetProgress.write(issueInfos, prRefs, {
      current: this.tokenTracker.getTotal(),
      budget: this.config.options.tokenBudget,
    });
  }

  /**
   * Write incremental progress update (during processing).
   */
  private async writeFleetProgressIncremental(): Promise<void> {
    const issueInfos: IssueProgressInfo[] = this.issues.map((issue) => {
      const status = this.fleetCheckpoint.getIssueStatus(issue.number);
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        status: status?.status ?? 'not-started',
        currentPhase: status?.lastPhase ?? 0,
        totalPhases: getPhaseCount(),
      };
    });

    await this.fleetProgress.write(issueInfos, [], {
      current: this.tokenTracker.getTotal(),
      budget: this.config.options.tokenBudget,
    });
  }
}
