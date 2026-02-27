import type { RuntimeConfig } from '../config/loader.js';
import { WorktreeManager } from '../git/worktree.js';
import { FleetCheckpointManager } from './checkpoint.js';
import type { PlatformProvider } from '../platform/provider.js';
import type { Logger } from '../logging/logger.js';

export class WorktreeLifecycleService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly provider: PlatformProvider,
  ) {}

  private get agentDir(): string {
    return this.config.agent.copilot.agentDir;
  }

  private get backend(): string {
    return this.config.agent.backend;
  }

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
      this.config.stateDir,
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
}
