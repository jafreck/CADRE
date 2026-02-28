import { simpleGit } from 'simple-git';
import type { RuntimeConfig } from '../config/loader.js';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { FleetOrchestrator, type FleetResult } from './fleet-orchestrator.js';
import { ensureDir } from '../util/fs.js';
import type { IssueDetail } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import type { Logger } from '../logging/logger.js';
import { killAllTrackedProcesses } from '../util/process.js';
import { FleetProgressWriter } from './progress.js';
import {
  PreRunValidationSuite,
  gitValidator,
  agentBackendValidator,
  platformValidator,
  commandValidator,
  diskValidator,
  registryCompletenessValidator,
  checkStaleState,
} from '../validation/index.js';
import type { NotificationManager } from '../notifications/manager.js';
import { DependencyResolver } from './dependency-resolver.js';
import type { IssueDag } from './issue-dag.js';
import { DependencyResolutionError, StaleStateError, RuntimeInterruptedError } from '../errors.js';

export class RunCoordinator {
  private isShuttingDown = false;
  private activeIssueNumbers: number[] = [];
  private interruptReject: ((err: RuntimeInterruptedError) => void) | null = null;

  private get agentDir(): string {
    return this.config.agent.copilot.agentDir;
  }

  private get backend(): string {
    return this.config.agent.backend;
  }

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly provider: PlatformProvider,
    private readonly notifications: NotificationManager,
  ) {}

  /**
   * Run pre-flight validation checks and return true if all pass.
   */
  async validate(): Promise<boolean> {
    const suite = new PreRunValidationSuite([
      gitValidator,
      agentBackendValidator,
      platformValidator,
      commandValidator,
      diskValidator,
      registryCompletenessValidator,
    ]);
    return suite.run(this.config);
  }

  /**
   * Run the full CADRE pipeline.
   */
  async run(): Promise<FleetResult> {
    // Ensure the state directory exists before anything writes there
    await ensureDir(this.config.stateDir);

    // Run validation unless explicitly skipped
    if (this.config.options.skipValidation === false) {
      const passed = await this.validate();
      if (!passed) {
        throw new Error('Pre-run validation failed. Fix the errors above or use --skip-validation to bypass.');
      }

      // Run stale-state pre-flight check for explicit issue IDs
      if ('ids' in this.config.issues && this.config.issues.ids.length > 0) {
        const git = simpleGit(this.config.repoPath);
        await this.provider.connect();
        try {
          const staleResult = await checkStaleState(
            this.config.issues.ids,
            this.config,
            this.provider,
            git,
          );
          if (staleResult.hasConflicts) {
            throw new StaleStateError(
              `Stale state detected for ${staleResult.conflicts.size} issue(s)`,
              staleResult,
            );
          }
        } finally {
          await this.provider.disconnect();
        }
      }
    }

    // Set up graceful shutdown
    this.setupShutdownHandlers();

    // Create a deferred promise that rejects when a signal fires during execution
    const interruptPromise = new Promise<never>((_resolve, reject) => {
      this.interruptReject = reject;
    });

    this.logger.info('CADRE Runtime starting', {
      data: {
        projectName: this.config.projectName,
        repository: this.config.repository,
        maxParallelIssues: this.config.options.maxParallelIssues,
      },
    });

    // 1. Connect to platform provider
    await this.provider.connect();

    // Verify authentication
    const authed = await this.provider.checkAuth();
    if (!authed) {
      throw new Error(
        `${this.provider.name} authentication failed. Check your platform configuration.`,
      );
    }

    // 2. Resolve issues
    const issues = await this.resolveIssues();
    if (issues.length === 0) {
      this.logger.warn('No issues to process');
      await this.provider.disconnect();
      return this.emptyResult();
    }

    this.logger.info(`Resolved ${issues.length} issues: ${issues.map((i) => `#${i.number}`).join(', ')}`);
    this.activeIssueNumbers = issues.map((i) => i.number);

    // 3. Initialize components
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot,
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
      this.agentDir,
      this.backend,
      this.config.stateDir,
    );

    const launcher = new AgentLauncher(this.config, this.logger);
    await launcher.init();

    // 3b. Optionally resolve issue dependency graph (DAG mode)
    let dag: IssueDag | undefined;
    if (this.config.dag?.enabled) {
      this.logger.info('DAG mode enabled — resolving issue dependency graph');
      const resolver = new DependencyResolver(this.config, launcher, this.logger, worktreeManager);
      try {
        dag = await resolver.resolve(issues, this.config.repoPath);
        this.logger.info(`DAG resolved: ${dag.getWaves().length} wave(s)`);
      } catch (err) {
        if (err instanceof DependencyResolutionError) {
          throw new Error(`DAG dependency resolution failed: ${err.message}`);
        }
        throw err;
      }
    }

    // 4. Create and run fleet orchestrator
    const fleet = new FleetOrchestrator(
      this.config,
      issues,
      worktreeManager,
      launcher,
      this.provider,
      this.logger,
      this.notifications,
      dag,
    );

    const result = await Promise.race([
      this.config.options.respondToReviews
        ? fleet.runReviewResponse(this.activeIssueNumbers)
        : fleet.run(),
      interruptPromise,
    ]);
    this.interruptReject = null;

    // 5. Disconnect platform provider
    await this.provider.disconnect();

    // 6. Print summary
    this.printSummary(result);

    return result;
  }

  /**
   * Resolve issues from config using the platform provider.
   */
  private async resolveIssues(): Promise<IssueDetail[]> {
    if ('ids' in this.config.issues) {
      this.logger.info(`Resolving ${this.config.issues.ids.length} explicit issues`);
      const issues: IssueDetail[] = [];
      for (const id of this.config.issues.ids) {
        try {
          const issue = await this.provider.getIssue(id);
          issues.push(issue);
        } catch (err) {
          this.logger.error(`Failed to fetch issue #${id}: ${err}`, { issueNumber: id });
        }
      }
      return issues;
    }

    if ('query' in this.config.issues) {
      const q = this.config.issues.query;
      // When DAG mode is enabled, fetch all matching issues so the full dependency
      // graph can be constructed. The concurrency limit (maxParallelIssues) only
      // applies to execution, not to graph construction.
      const limit = this.config.dag?.enabled ? undefined : q.limit;
      this.logger.info('Resolving issues from query', {
        data: { ...q as Record<string, unknown>, effectiveLimit: limit ?? 'unlimited' },
      });
      return this.provider.listIssues({
        labels: q.labels,
        milestone: q.milestone,
        assignee: q.assignee,
        state: q.state,
        limit,
      });
    }

    return [];
  }

  /**
   * Set up SIGINT/SIGTERM handlers for graceful shutdown.
   */
  private setupShutdownHandlers(): void {
    const handler = async (signal: string): Promise<void> => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      this.logger.warn(`Received ${signal} — shutting down gracefully`);

      // Reject the deferred promise to propagate RuntimeInterruptedError to the caller
      this.interruptReject?.(new RuntimeInterruptedError(
        `Runtime interrupted by ${signal}`,
        signal,
        signal === 'SIGINT' ? 130 : 143,
      ));

      // Kill all running agent processes
      killAllTrackedProcesses();

      // Disconnect platform provider
      await this.provider.disconnect();

      // Write interrupted status to progress
      const progressWriter = new FleetProgressWriter(this.config.stateDir, this.logger);
      await progressWriter.appendEvent(`Fleet interrupted by user (${signal})`);

      // Notify about interruption
      await this.notifications.dispatch({
        type: 'fleet-interrupted',
        signal,
        issuesInProgress: this.activeIssueNumbers,
      });
    };

    process.on('SIGINT', () => void handler('SIGINT'));
    process.on('SIGTERM', () => void handler('SIGTERM'));
  }

  /**
   * Print a summary of the fleet run.
   */
  private printSummary(result: FleetResult): void {
    const duration = (result.totalDuration / 1000).toFixed(1);

    console.log('\n=== CADRE Fleet Summary ===\n');
    console.log(`  Status: ${result.success ? '✅ All issues resolved' : '⚠️  Some issues failed'}`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Issues: ${result.issues.length} total`);
    console.log(`  PRs Created: ${result.prsCreated.length}`);
    console.log(`  Failed: ${result.failedIssues.length}`);
    console.log(`  Tokens: ${result.tokenUsage.total.toLocaleString()}`);

    if (result.prsCreated.length > 0) {
      console.log('\n  PRs:');
      for (const pr of result.prsCreated) {
        console.log(`    #${pr.number}: ${pr.url}`);
      }
    }

    if (result.failedIssues.length > 0) {
      console.log('\n  Failures:');
      for (const fail of result.failedIssues) {
        console.log(`    #${fail.issueNumber}: ${fail.error}`);
      }
    }

    console.log('');

    // Cost estimate
    const estimator = new CostEstimator(this.config.copilot);
    const estimate = estimator.estimate(result.tokenUsage.total, this.config.copilot.model);
    console.log(`  Estimated cost: ${estimator.format(estimate)}`);
    console.log('');
  }

  private emptyResult(): FleetResult {
    return {
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      codeDoneNoPR: [],
      totalDuration: 0,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
    };
  }
}
