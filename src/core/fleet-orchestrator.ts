import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager, RemoteBranchMissingError, type WorktreeInfo } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager, FleetCheckpointManager } from './checkpoint.js';
import { FleetProgressWriter } from './progress.js';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { TokenTracker, type TokenSummary } from '../budget/token-tracker.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { Logger } from '../logging/logger.js';
import { NotificationManager } from '../notifications/manager.js';
import { ReviewResponseOrchestrator } from './review-response-orchestrator.js';
import { IssueDag } from './issue-dag.js';
import { DependencyMergeConflictError } from '../errors.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ensureDir } from '../util/fs.js';
import type { DependencyMergeConflictContext } from '../git/dependency-branch-merger.js';
import { FleetEventBus } from './fleet-event-bus.js';
import { FleetReporter } from './fleet-reporter.js';
import { FleetScheduler } from './fleet-scheduler.js';

export interface FleetResult {
  /** Whether all issues were resolved successfully. */
  success: boolean;
  /** Per-issue outcomes. */
  issues: IssueResult[];
  /** Issues that completed and had PRs opened. */
  prsCreated: PullRequestInfo[];
  /** Issues that failed or were blocked. */
  failedIssues: Array<{ issueNumber: number; error: string }>;
  /** Issues where code is complete but no PR was created. */
  codeDoneNoPR: Array<{ issueNumber: number; branch: string }>;
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
  private readonly contextBuilder: ContextBuilder;
  private fleetBudgetExceeded = false;
  private eventBus!: FleetEventBus;
  private reporter!: FleetReporter;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly issues: IssueDetail[],
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager = new NotificationManager(),
    private readonly dag?: IssueDag,
    private readonly dagDepMap?: Record<number, number[]>,
  ) {
    this.cadreDir = join(config.repoPath, '.cadre');
    this.fleetCheckpoint = new FleetCheckpointManager(this.cadreDir, config.projectName, logger);
    this.fleetProgress = new FleetProgressWriter(this.cadreDir, logger);
    this.tokenTracker = new TokenTracker();
    this.costEstimator = new CostEstimator(config.copilot);
    this.contextBuilder = new ContextBuilder(config, logger);
  }

  /**
   * Execute all issue pipelines with bounded parallelism.
   */
  async run(): Promise<FleetResult> {

    const startTime = Date.now();

    // Load fleet checkpoint
    await this.fleetCheckpoint.load();

    const eventBus = new FleetEventBus(this.notifications, this.fleetProgress);
    const reporter = new FleetReporter(
      this.config, this.issues, this.fleetCheckpoint, this.fleetProgress, this.tokenTracker, this.logger,
    );
    const scheduler = new FleetScheduler(
      this.config, this.issues, this.fleetCheckpoint, this.platform, this.logger, this.dagDepMap,
    );
    this.eventBus = eventBus;
    this.reporter = reporter;

    this.logger.info(`Fleet starting: ${this.issues.length} issues, max ${this.config.options.maxParallelIssues} parallel`);
    await eventBus.appendFleetStarted(this.issues.length);
    await eventBus.dispatchFleetStarted(this.issues.length, this.config.options.maxParallelIssues);

    // Filter out already completed issues on resume
    const issuesToProcess = this.config.options.resume
      ? this.issues.filter((issue) => !this.fleetCheckpoint.isIssueCompleted(issue.number))
      : this.issues;

    if (issuesToProcess.length < this.issues.length) {
      const skipped = this.issues.length - issuesToProcess.length;
      this.logger.info(`Resume: skipping ${skipped} already-completed issues`);
    }

    // Pre-fetch remote refs once before any per-issue pipeline starts
    await this.worktreeManager.prefetch();

    const results = await scheduler.schedule(
      issuesToProcess,
      (issue, dag) => this.processIssue(issue, dag),
      (issue) => this.markIssueDepBlocked(issue),
      this.dag,
    );

    // Aggregate results
    const fleetResult = reporter.aggregateResults(results, startTime);

    // Write run report
    await reporter.writeReport(fleetResult, startTime);

    // Write final progress
    await reporter.writeFleetProgress(fleetResult);
    await eventBus.appendFleetCompleted(fleetResult.prsCreated.length, fleetResult.failedIssues.length);
    await eventBus.dispatchFleetCompleted(
      fleetResult.success,
      fleetResult.prsCreated.length,
      fleetResult.failedIssues.length,
      fleetResult.totalDuration,
      fleetResult.tokenUsage.total,
    );

    return fleetResult;
  }

  /**
   * Execute review-response pipelines (phases 3–5) for issues with open PRs
   * that have unresolved review threads.
   */
  async runReviewResponse(issueNumbers?: number[]): Promise<FleetResult> {
    const startTime = Date.now();
    const orchestrator = new ReviewResponseOrchestrator(
      this.config,
      this.worktreeManager,
      this.launcher,
      this.platform,
      this.logger,
      this.notifications,
    );

    const rrResult = await orchestrator.run(issueNumbers);

    const issueResults: IssueResult[] = rrResult.issues
      .filter((o) => !o.skipped && o.result != null)
      .map((o) => o.result!);

    const prsCreated = issueResults.filter((r) => r.pr != null).map((r) => r.pr!);

    const failedIssues = rrResult.issues
      .filter((o) => !o.skipped && (o.result == null || !o.result.success))
      .map((o) => ({
        issueNumber: o.issueNumber,
        error: o.result?.error ?? 'Review response pipeline failed',
      }));

    return {
      success: failedIssues.length === 0,
      issues: issueResults,
      prsCreated,
      failedIssues,
      codeDoneNoPR: [],
      totalDuration: Date.now() - startTime,
      tokenUsage: this.tokenTracker.getSummary(),
    };
  }

  /**
   * Process a single issue through its full pipeline.
   */
  private async processIssue(issue: IssueDetail, dag?: IssueDag): Promise<IssueResult> {
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
        issue.title,
        'Fleet budget exceeded',
      );
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
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
      // 1. Check for an existing open PR before provisioning
      const branchName = this.worktreeManager.resolveBranchName(issue.number, issue.title);
      try {
        const existingPR = await this.platform.findOpenPR(issue.number, branchName);
        if (existingPR !== null) {
          this.logger.info(
            `Skipping issue #${issue.number}: existing open PR found at ${existingPR.url}`,
            { issueNumber: issue.number },
          );
          await this.fleetCheckpoint.setIssueStatus(
            issue.number,
            'completed',
            '',
            branchName,
            0,
            issue.title,
          );
          return {
            issueNumber: issue.number,
            issueTitle: issue.title,
            success: true,
            codeComplete: false,
            pr: existingPR,
            phases: [],
            totalDuration: 0,
            tokenUsage: 0,
          };
        }
      } catch (prErr) {
        this.logger.warn(
          `Could not check for existing PR for issue #${issue.number}: ${prErr}`,
          { issueNumber: issue.number },
        );
      }

      // 2. Provision worktree
      let worktree: WorktreeInfo;
      if (dag) {
        const transitiveDeps = dag.getTransitiveDepsOrdered(issue.number);
        if (transitiveDeps.length > 0) {
          try {
            worktree = await this.worktreeManager.provisionWithDeps(
              issue.number,
              issue.title,
              transitiveDeps,
              this.config.options.resume,
              this.config.dag?.onDependencyMergeConflict === 'resolve'
                ? (ctx: DependencyMergeConflictContext) => this.resolveDagDependencyMergeConflict(issue, ctx)
                : undefined,
            );
          } catch (err) {
            if (err instanceof DependencyMergeConflictError) {
              const error = String(err);
              this.logger.warn(
                `Dependency merge conflict for issue #${issue.number}: ${error}`,
                { issueNumber: issue.number },
              );
              await this.fleetCheckpoint.setIssueStatus(
                issue.number,
                'dep-merge-conflict',
                '',
                '',
                0,
                issue.title,
                error,
              );
              return {
                issueNumber: issue.number,
                issueTitle: issue.title,
                success: false,
                codeComplete: false,
                phases: [],
                totalDuration: 0,
                tokenUsage: 0,
                error,
              };
            }
            throw err;
          }
        } else {
          worktree = await this.worktreeManager.provision(
            issue.number,
            issue.title,
            this.config.options.resume,
          );
        }
      } else {
        worktree = await this.worktreeManager.provision(
          issue.number,
          issue.title,
          this.config.options.resume,
        );
      }

      // 3. Update fleet checkpoint
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'in-progress',
        worktree.path,
        worktree.branch,
        0,
        issue.title,
      );

      // 4. Set up per-issue progress directory
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
        this.notifications,
      );

      // 6. Run the 5-phase pipeline
      const result = await issueOrchestrator.run();

      // 7. Update fleet checkpoint
      const status = result.budgetExceeded
        ? 'budget-exceeded'
        : result.success
          ? 'completed'
          : result.codeComplete
            ? 'code-complete'
            : 'failed';
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        status,
        worktree.path,
        worktree.branch,
        result.phases.length,
        issue.title,
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
        await this.eventBus.dispatchBudgetExceeded(
          this.tokenTracker.getTotal(),
          this.config.options.tokenBudget ?? 0,
        );
      } else if (budgetStatus === 'warning') {
        const current = this.tokenTracker.getTotal();
        const budget = this.config.options.tokenBudget ?? 0;
        await this.eventBus.dispatchBudgetWarning(
          current,
          budget,
          budget > 0 ? Math.round((current / budget) * 100) : 0,
        );
      }

      // Update progress
      await this.reporter.writeFleetProgressIncremental();

      return result;
    } catch (err) {
      if (err instanceof RemoteBranchMissingError) {
        const error = `Skipping issue #${issue.number}: remote branch is missing — ${err.message}`;
        this.logger.warn(error, { issueNumber: issue.number });
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
          phases: [],
          totalDuration: 0,
          tokenUsage: 0,
          error,
        };
      }

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
        issue.title,
        error,
      );

      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
        phases: [],
        totalDuration: 0,
        tokenUsage: 0,
        error,
      };
    }
  }

  private async resolveDagDependencyMergeConflict(
    issue: IssueDetail,
    context: DependencyMergeConflictContext,
  ): Promise<boolean> {
    const progressDir = join(this.cadreDir, 'issues', String(issue.number));
    await ensureDir(progressDir);

    this.logger.info(
      `DAG dependency merge conflict detected for issue #${issue.number}; launching dep-conflict-resolver`,
      { issueNumber: issue.number, data: { conflictedFiles: context.conflictedFiles, conflictingBranch: context.conflictingBranch } },
    );

    const conflictContextPath = await this.contextBuilder.build('dep-conflict-resolver', {
      issueNumber: issue.number,
      worktreePath: context.depsWorktreePath,
      conflictedFiles: context.conflictedFiles,
      conflictingBranch: context.conflictingBranch,
      depsBranch: context.depsBranch,
      progressDir,
    });

    const resolverResult = await this.launcher.launchAgent(
      {
        agent: 'dep-conflict-resolver',
        issueNumber: issue.number,
        phase: 0,
        contextPath: conflictContextPath,
        outputPath: join(progressDir, 'dep-conflict-resolution-report.md'),
      },
      context.depsWorktreePath,
    );

    if (!resolverResult.success || !resolverResult.outputExists) {
      this.logger.warn(
        `dep-conflict-resolver failed for issue #${issue.number}; proceeding with dep-merge-conflict fallback`,
        {
          issueNumber: issue.number,
          data: {
            timedOut: resolverResult.timedOut,
            exitCode: resolverResult.exitCode,
            outputExists: resolverResult.outputExists,
          },
        },
      );
      return false;
    }

    this.logger.info(`dep-conflict-resolver completed for issue #${issue.number}`, {
      issueNumber: issue.number,
      data: { outputPath: resolverResult.outputPath },
    });
    return true;
  }

  /**
   * Mark a single issue as dep-blocked in the fleet checkpoint and return a failed IssueResult.
   */
  private async markIssueDepBlocked(issue: IssueDetail): Promise<IssueResult> {
    this.logger.info(`Marking issue #${issue.number} as dep-blocked`, { issueNumber: issue.number });
    await this.fleetCheckpoint.setIssueStatus(
      issue.number,
      'dep-blocked',
      '',
      '',
      0,
      issue.title,
      'Blocked by dependency failure',
    );
    return {
      issueNumber: issue.number,
      issueTitle: issue.title,
      success: false,
      codeComplete: false,
      phases: [],
      totalDuration: 0,
      tokenUsage: 0,
      error: 'dep-blocked',
    };
  }
}
