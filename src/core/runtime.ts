import { join } from 'node:path';
import type { CadreConfig } from '../config/schema.js';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { FleetOrchestrator, type FleetResult } from './fleet-orchestrator.js';
import { FleetCheckpointManager } from './checkpoint.js';
import { IssueFetcher, type IssueDetail } from '../github/issues.js';
import { IssueQueryResolver } from '../github/query.js';
import { GitHubAPI } from '../github/api.js';
import { GitHubMCPClient } from '../github/mcp-client.js';
import { TokenTracker } from '../budget/token-tracker.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { Logger } from '../logging/logger.js';
import { killAllTrackedProcesses } from '../util/process.js';
import { FleetProgressWriter } from './progress.js';

/**
 * Top-level CadreRuntime — the main entry point for running CADRE.
 */
export class CadreRuntime {
  private readonly logger: Logger;
  private readonly cadreDir: string;
  private readonly mcpClient: GitHubMCPClient;
  private isShuttingDown = false;

  constructor(private readonly config: CadreConfig) {
    this.cadreDir = join(config.repoPath, '.cadre');
    this.logger = new Logger({
      source: 'fleet',
      logDir: join(this.cadreDir, 'logs'),
      level: 'info',
      console: true,
    });

    // Build GitHub App auth env vars for the MCP server process
    const resolveEnvRef = (value: string) =>
      value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');

    const appAuth = config.github.auth;
    const mcpEnv: Record<string, string> = {
      GITHUB_APP_ID: resolveEnvRef(appAuth.appId),
      GITHUB_APP_INSTALLATION_ID: resolveEnvRef(appAuth.installationId),
      GITHUB_APP_PRIVATE_KEY_FILE: resolveEnvRef(appAuth.privateKeyFile),
    };

    this.mcpClient = new GitHubMCPClient(
      {
        command: config.github.mcpServer.command,
        args: config.github.mcpServer.args,
        env: mcpEnv,
      },
      this.logger,
    );
  }

  /**
   * Run the full CADRE pipeline.
   */
  async run(): Promise<FleetResult> {
    // Set up graceful shutdown
    this.setupShutdownHandlers();

    this.logger.info('CADRE Runtime starting', {
      data: {
        projectName: this.config.projectName,
        repository: this.config.repository,
        maxParallelIssues: this.config.options.maxParallelIssues,
      },
    });

    // 1. Connect to GitHub MCP server
    await this.mcpClient.connect();

    const githubAPI = new GitHubAPI(
      this.config.repository,
      this.logger,
      this.mcpClient,
    );

    // Verify authentication
    const authed = await githubAPI.checkAuth();
    if (!authed) {
      throw new Error(
        'GitHub MCP server is not authenticated. Check your github.auth configuration (appId, installationId, privateKeyFile).',
      );
    }

    // 2. Resolve issues
    const issues = await this.resolveIssues();
    if (issues.length === 0) {
      this.logger.warn('No issues to process');
      await this.mcpClient.disconnect();
      return this.emptyResult();
    }

    this.logger.info(`Resolved ${issues.length} issues: ${issues.map((i) => `#${i.number}`).join(', ')}`);

    // 3. Initialize components
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot ?? join(this.cadreDir, 'worktrees'),
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
    );

    const launcher = new AgentLauncher(this.config, this.logger);
    await launcher.init();

    // 4. Create and run fleet orchestrator
    const fleet = new FleetOrchestrator(
      this.config,
      issues,
      worktreeManager,
      launcher,
      githubAPI,
      this.logger,
    );

    const result = await fleet.run();

    // 5. Disconnect MCP client
    await this.mcpClient.disconnect();

    // 6. Print summary
    this.printSummary(result);

    return result;
  }

  /**
   * Show current progress status.
   */
  async status(issueNumber?: number): Promise<void> {
    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );

    const state = await checkpointManager.load();

    console.log('\n=== CADRE Fleet Status ===\n');
    console.log(`Project: ${state.projectName}`);
    console.log(`Issues tracked: ${Object.keys(state.issues).length}`);
    console.log(`Total tokens: ${state.tokenUsage.total.toLocaleString()}`);
    console.log(`Last checkpoint: ${state.lastCheckpoint}`);
    console.log(`Resume count: ${state.resumeCount}\n`);

    for (const [num, issue] of Object.entries(state.issues)) {
      if (issueNumber && Number(num) !== issueNumber) continue;
      console.log(`  #${num}: ${issue.status} (phase ${issue.lastPhase})`);
      if (issue.error) {
        console.log(`    Error: ${issue.error}`);
      }
    }

    console.log('');
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
      await checkpointManager.setIssueStatus(issueNumber, 'not-started', '', '', 0);
      console.log(`Reset issue #${issueNumber}`);
    } else {
      this.logger.info('Resetting entire fleet');
      // Clear all issue statuses
      for (const num of Object.keys(state.issues)) {
        await checkpointManager.setIssueStatus(Number(num), 'not-started', '', '', 0);
      }
      console.log('Reset all issues');
    }
  }

  /**
   * List active worktrees.
   */
  async listWorktrees(): Promise<void> {
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot ?? join(this.cadreDir, 'worktrees'),
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
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
   */
  async pruneWorktrees(): Promise<void> {
    const worktreeManager = new WorktreeManager(
      this.config.repoPath,
      this.config.worktreeRoot ?? join(this.cadreDir, 'worktrees'),
      this.config.baseBranch,
      this.config.branchTemplate,
      this.logger,
    );

    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );
    const state = await checkpointManager.load();

    const worktrees = await worktreeManager.listActive();
    let pruned = 0;

    for (const wt of worktrees) {
      const issueStatus = state.issues[wt.issueNumber];
      if (issueStatus?.status === 'completed') {
        await worktreeManager.remove(wt.issueNumber);
        pruned++;
        console.log(`  Pruned: issue #${wt.issueNumber}`);
      }
    }

    console.log(`\nPruned ${pruned} worktrees`);
  }

  /**
   * Resolve issues from config.
   */
  private async resolveIssues(): Promise<IssueDetail[]> {
    const resolver = new IssueQueryResolver(this.config, this.logger, this.mcpClient);
    return resolver.resolve();
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

      // Disconnect MCP client
      await this.mcpClient.disconnect();

      // Write interrupted status to progress
      const progressWriter = new FleetProgressWriter(this.cadreDir, this.logger);
      await progressWriter.appendEvent(`Fleet interrupted by user (${signal})`);

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
      totalDuration: 0,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    };
  }
}
