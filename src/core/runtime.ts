import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { RuntimeConfig } from '../config/loader.js';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { FleetOrchestrator, type FleetResult } from './fleet-orchestrator.js';
import { FleetCheckpointManager, CheckpointManager } from './checkpoint.js';
import { exists, ensureDir } from '../util/fs.js';
import { renderFleetStatus, renderIssueDetail } from '../cli/status-renderer.js';
import type { IssueDetail } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { createPlatformProvider } from '../platform/factory.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { Logger } from '../logging/logger.js';
import { killAllTrackedProcesses } from '../util/process.js';
import { FleetProgressWriter } from './progress.js';
import {
  PreRunValidationSuite,
  gitValidator,
  agentBackendValidator,
  platformValidator,
  commandValidator,
  diskValidator,
  checkStaleState,
} from '../validation/index.js';
import { ReportWriter } from '../reporting/report-writer.js';
import { NotificationManager, createNotificationManager } from '../notifications/manager.js';

/**
 * Top-level CadreRuntime — the main entry point for running CADRE.
 */
export class CadreRuntime {
  private readonly logger: Logger;
  private readonly cadreDir: string;
  private readonly provider: PlatformProvider;
  private readonly notifications: NotificationManager;
  private isShuttingDown = false;
  private activeIssueNumbers: number[] = [];

  private get agentDir(): string {
    return this.config.agent.copilot.agentDir;
  }

  private get backend(): string {
    return this.config.agent.backend;
  }

  constructor(private readonly config: RuntimeConfig) {
    this.cadreDir = config.stateDir;
    this.logger = new Logger({
      source: 'fleet',
      logDir: join(this.cadreDir, 'logs'),
      level: 'info',
      console: true,
    });

    // Create the platform provider (GitHub or Azure DevOps)
    this.provider = createPlatformProvider(config, this.logger);

    this.notifications = createNotificationManager(config);
  }

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
    ]);
    return suite.run(this.config);
  }

  /**
   * Run the full CADRE pipeline.
   */
  async run(): Promise<FleetResult> {
    // Ensure the state directory exists before anything writes there
    await ensureDir(this.cadreDir);

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
            console.error('\nStale state detected — aborting run. Resolve the conflicts below before starting:\n');
            for (const [issueNumber, issueConflicts] of staleResult.conflicts) {
              console.error(`  Issue #${issueNumber}:`);
              for (const conflict of issueConflicts) {
                console.error(`    [${conflict.kind}] ${conflict.description}`);
              }
            }
            console.error('');
            process.exit(1);
          }
        } finally {
          await this.provider.disconnect();
        }
      }
    }

    // Set up graceful shutdown
    this.setupShutdownHandlers();

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
    );

    const launcher = new AgentLauncher(this.config, this.logger);
    await launcher.init();

    // 4. Create and run fleet orchestrator
    const fleet = new FleetOrchestrator(
      this.config,
      issues,
      worktreeManager,
      launcher,
      this.provider,
      this.logger,
      this.notifications,
    );

    const result = this.config.options.respondToReviews
      ? await fleet.runReviewResponse(this.activeIssueNumbers)
      : await fleet.run();

    // 5. Disconnect platform provider
    await this.provider.disconnect();

    // 6. Print summary
    this.printSummary(result);

    return result;
  }

  /**
   * Show current progress status.
   */
  async status(issueNumber?: number): Promise<void> {
    const fleetCheckpointPath = join(this.cadreDir, 'fleet-checkpoint.json');

    if (!(await exists(fleetCheckpointPath))) {
      console.log('No fleet checkpoint found.');
      return;
    }

    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );

    const state = await checkpointManager.load();

    if (issueNumber !== undefined) {
      const issueStatus = state.issues[issueNumber];
      if (!issueStatus) {
        console.log(`Issue #${issueNumber} not found in fleet checkpoint.`);
        return;
      }

      const issueProgressDir = join(this.cadreDir, 'issues', String(issueNumber));
      const issueCheckpointPath = join(issueProgressDir, 'checkpoint.json');

      if (!(await exists(issueCheckpointPath))) {
        console.log(`No per-issue checkpoint found for issue #${issueNumber}`);
        return;
      }

      const issueCpManager = new CheckpointManager(issueProgressDir, this.logger);
      try {
        const issueCheckpoint = await issueCpManager.load(String(issueNumber));
        console.log(renderIssueDetail(issueNumber, issueStatus, issueCheckpoint));
      } catch {
        console.log(`No per-issue checkpoint found for issue #${issueNumber}`);
      }
    } else {
      console.log(renderFleetStatus(state, this.config.copilot.model, this.config.copilot));
    }
  }

  /**
   * Reset fleet or issue state.
   */
  async reset(issueNumber?: number, fromPhase?: number): Promise<void> {
    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );

    const state = await checkpointManager.load();

    if (issueNumber) {
      this.logger.info(`Resetting issue #${issueNumber}`, {
        issueNumber,
        data: { fromPhase },
      });
      await checkpointManager.setIssueStatus(issueNumber, 'not-started', '', '', 0, state.issues[issueNumber]?.issueTitle ?? '');
      console.log(`Reset issue #${issueNumber}`);
    } else {
      this.logger.info('Resetting entire fleet');
      // Clear all issue statuses
      for (const num of Object.keys(state.issues)) {
        await checkpointManager.setIssueStatus(Number(num), 'not-started', '', '', 0, state.issues[Number(num)]?.issueTitle ?? '');
      }
      console.log('Reset all issues');
    }
  }

  /**
   * Print a report of the most recent run, all run history, or raw JSON.
   */
  async report(options: { format?: 'json'; history?: boolean } = {}): Promise<void> {
    const paths = await ReportWriter.listReports(this.cadreDir);

    if (options.history) {
      if (paths.length === 0) {
        console.log('No reports found.');
        return;
      }
      for (const p of paths) {
        console.log(p);
      }
      return;
    }

    if (paths.length === 0) {
      console.log('No reports found.');
      return;
    }

    const mostRecent = paths[paths.length - 1];
    const run = await ReportWriter.readReport(mostRecent);

    if (options.format === 'json') {
      console.log(JSON.stringify(run));
      return;
    }

    const duration = (run.duration / 1000).toFixed(1);
    const estimator = new CostEstimator(this.config.copilot);
    const costStr = estimator.format(estimator.estimate(run.totalTokens, this.config.copilot.model));

    console.log('\n=== CADRE Run Report ===\n');
    console.log(`  Run ID:   ${run.runId}`);
    console.log(`  Project:  ${run.project}`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Issues:   ${run.totals.issues}`);
    console.log(`  PRs:      ${run.totals.prsCreated}`);
    console.log(`  Failures: ${run.totals.failures}`);
    console.log(`  Tokens:   ${run.totalTokens.toLocaleString()}`);
    console.log(`  Cost:     ${costStr}`);
    console.log('');
  }

  /**
   * List active worktrees.
   */
  async listWorktrees(): Promise<void> {
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot,
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
      this.agentDir,
      this.backend,
    );

    const worktrees = await worktreeManager.listActive();

    console.log('\n=== Active CADRE Worktrees ===\n');

    if (worktrees.length === 0) {
      console.log('  No active worktrees');
    } else {
      for (const wt of worktrees) {
        console.log(`  Issue #${wt.issueNumber}`);
        console.log(`    Path: ${wt.path}`);
        console.log(`    Branch: ${wt.branch}`);
        console.log(`    Base: ${wt.baseCommit.slice(0, 8)}`);
        console.log('');
      }
    }
  }

  /**
   * Prune worktrees for completed/merged issues.
   *
   * A worktree is pruned when either:
   *   1. The local fleet checkpoint records its status as 'completed', OR
   *   2. The platform reports the associated branch's PR as closed or merged
   *      (i.e. the work is done even if the checkpoint was never updated).
   */
  async pruneWorktrees(): Promise<void> {
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot,
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
      this.agentDir,
      this.backend,
    );

    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );
    const state = await checkpointManager.load();
    const worktrees = await worktreeManager.listActive();
    let pruned = 0;

    // Connect to platform provider so we can query live PR state
    await this.provider.connect();
    try {
      for (const wt of worktrees) {
        const locallyCompleted = state.issues[wt.issueNumber]?.status === 'completed';

        // Check whether the branch's PR is closed or merged on the platform
        let prDone = false;
        try {
          const prs = await this.provider.listPullRequests({ head: wt.branch, state: 'all' });
          const matching = prs.find((pr) => pr.headBranch === wt.branch);
          if (matching) {
            prDone = matching.state === 'closed' || matching.state === 'merged';
          }
        } catch (err) {
          this.logger.warn(
            `Could not fetch PR state for issue #${wt.issueNumber} (branch ${wt.branch}): ${err}`,
            { issueNumber: wt.issueNumber },
          );
        }

        if (locallyCompleted || prDone) {
          const reasons = [
            locallyCompleted ? 'locally completed' : '',
            prDone ? 'PR closed/merged on platform' : '',
          ].filter(Boolean).join(', ');
          await worktreeManager.remove(wt.issueNumber);
          pruned++;
          console.log(`  Pruned: issue #${wt.issueNumber} (${reasons})`);
        } else {
          console.log(`  Skipped: issue #${wt.issueNumber} (PR still open or no PR found)`);
        }
      }
    } finally {
      await this.provider.disconnect();
    }

    console.log(`\nPruned ${pruned} worktrees`);
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
      this.logger.info('Resolving issues from query', {
        data: q as Record<string, unknown>,
      });
      return this.provider.listIssues({
        labels: q.labels,
        milestone: q.milestone,
        assignee: q.assignee,
        state: q.state,
        limit: q.limit,
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

      // Kill all running agent processes
      killAllTrackedProcesses();

      // Disconnect platform provider
      await this.provider.disconnect();

      // Write interrupted status to progress
      const progressWriter = new FleetProgressWriter(this.cadreDir, this.logger);
      await progressWriter.appendEvent(`Fleet interrupted by user (${signal})`);

      // Notify about interruption
      await this.notifications.dispatch({
        type: 'fleet-interrupted',
        signal,
        issuesInProgress: this.activeIssueNumbers,
      });

      // Exit with appropriate code
      process.exit(signal === 'SIGINT' ? 130 : 143);
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
