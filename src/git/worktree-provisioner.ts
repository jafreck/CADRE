import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Logger } from '../logging/logger.js';
import { exists, ensureDir } from '../util/fs.js';
import type { IssueDetail } from '../platform/provider.js';
import { AgentFileSync } from './agent-file-sync.js';
import { WorktreeCleaner } from './worktree-cleaner.js';
import { DependencyBranchMerger, type DependencyMergeConflictContext } from './dependency-branch-merger.js';

export class RemoteBranchMissingError extends Error {
  constructor(branch: string) {
    super(`Remote branch '${branch}' does not exist on origin`);
    this.name = 'RemoteBranchMissingError';
  }
}

export interface WorktreeInfo {
  /** Issue number this worktree is for. */
  issueNumber: number;
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name checked out in this worktree. */
  branch: string;
  /** Whether the worktree currently exists on disk. */
  exists: boolean;
  /** Base commit SHA the branch was created from. */
  baseCommit: string;
  /**
   * Worktree-relative paths of agent instruction files written by
   * `syncAgentFiles`.  Passed to `CommitManager` so that only these exact
   * files are unstaged before every commit, leaving any pre-existing agent
   * files in the target repo completely untouched.
   */
  syncedAgentFiles: string[];
}

/**
 * Encapsulates all git worktree provisioning, rebase, and lifecycle logic.
 * Composes AgentFileSync, WorktreeCleaner, and DependencyBranchMerger.
 */
export class WorktreeProvisioner {
  private readonly git: SimpleGit;
  private readonly agentFileSync: AgentFileSync;
  private readonly worktreeCleaner: WorktreeCleaner;
  private readonly dependencyBranchMerger: DependencyBranchMerger;

  constructor(
    private readonly repoPath: string,
    private readonly worktreeRoot: string,
    private readonly baseBranch: string,
    private readonly branchTemplate: string,
    private readonly logger: Logger,
    private readonly agentDir?: string,
    private readonly backend: string = 'copilot',
  ) {
    this.git = simpleGit(repoPath);
    this.agentFileSync = new AgentFileSync(agentDir, backend, logger);
    this.worktreeCleaner = new WorktreeCleaner(this.git, worktreeRoot, logger);
    this.dependencyBranchMerger = new DependencyBranchMerger(
      this.git,
      repoPath,
      logger,
      this.resolveBranchName.bind(this),
    );
  }

  /**
   * Create a worktree for an issue.
   * If the worktree already exists, validate and return info.
   * When `resume` is true and the worktree is absent, check the remote branch and
   * recreate the worktree from it; throws `RemoteBranchMissingError` if the remote
   * branch does not exist.
   */
  async provision(issueNumber: number, issueTitle: string, resume?: boolean): Promise<WorktreeInfo> {
    const branch = this.resolveBranchName(issueNumber, issueTitle);
    const worktreePath = this.getWorktreePath(issueNumber);

    // Check if worktree already exists
    if (await exists(worktreePath)) {
      this.logger.info(`Worktree already exists for issue #${issueNumber}`, {
        issueNumber,
        data: { path: worktreePath, branch },
      });

      const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);
      const baseCommit = await this.getBaseCommit(worktreePath);
      return {
        issueNumber,
        path: worktreePath,
        branch,
        exists: true,
        baseCommit,
        syncedAgentFiles,
      };
    }

    // Resume path: worktree is absent, re-create from remote branch
    if (resume) {
      const remoteRef = `refs/heads/${branch}`;
      const lsRemoteOutput = await this.git.raw(['ls-remote', 'origin', remoteRef]);

      if (!lsRemoteOutput.trim()) {
        throw new RemoteBranchMissingError(branch);
      }

      // Fetch the remote branch and create the worktree tracking it
      await this.git.fetch('origin', branch);
      await ensureDir(this.worktreeRoot);
      await this.git.raw(['worktree', 'add', worktreePath, branch]);

      await this.agentFileSync.initCadreDir(worktreePath, issueNumber);
      const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);

      const baseCommit = await this.getBaseCommit(worktreePath);
      this.logger.info(`Resumed worktree for issue #${issueNumber} from remote branch`, {
        issueNumber,
        data: { path: worktreePath, branch },
      });

      return {
        issueNumber,
        path: worktreePath,
        branch,
        exists: true,
        baseCommit,
        syncedAgentFiles,
      };
    }

    // 1. Get the base commit SHA
    const baseCommit = await this.git.revparse([`origin/${this.baseBranch}`]).catch(async () => {
      // Fallback to local base branch
      return this.git.revparse([this.baseBranch]);
    });

    // 2. Create the branch if it doesn't exist
    const branchExists = await this.branchExistsLocal(branch);
    if (!branchExists) {
      await this.git.branch([branch, baseCommit.trim()]);
      this.logger.info(`Created branch ${branch} from ${baseCommit.trim().slice(0, 8)}`, {
        issueNumber,
      });
    }

    // 3. Create worktree directory
    await ensureDir(this.worktreeRoot);
    await this.git.raw(['worktree', 'add', worktreePath, branch]);

    // 4. Bootstrap the worktree's .cadre/ directory and gitignore cadre artifacts
    await this.agentFileSync.initCadreDir(worktreePath, issueNumber);
    const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);

    this.logger.info(`Provisioned worktree for issue #${issueNumber}`, {
      issueNumber,
      data: { path: worktreePath, branch, baseCommit: baseCommit.trim().slice(0, 8) },
    });

    return {
      issueNumber,
      path: worktreePath,
      branch,
      exists: true,
      baseCommit: baseCommit.trim(),
      syncedAgentFiles,
    };
  }

  /**
   * Create a worktree for an issue that depends on other issues.
   * Merges dependency branches (in topological order as provided) onto a
   * `cadre/deps-{issueNumber}` base branch, then creates the issue branch from it.
   * Throws DependencyMergeConflictError on merge conflict and writes .cadre/dep-conflict.json.
   */
  async provisionWithDeps(
    issueNumber: number,
    issueTitle: string,
    deps: IssueDetail[],
    resume?: boolean,
    resolveMergeConflict?: (context: DependencyMergeConflictContext) => Promise<boolean>,
  ): Promise<WorktreeInfo> {
    const depsBranch = `cadre/deps-${issueNumber}`;
    const issueBranch = this.resolveBranchName(issueNumber, issueTitle);
    const worktreePath = this.getWorktreePath(issueNumber);

    // Return existing worktree if already on disk
    if (await exists(worktreePath)) {
      this.logger.info(`Worktree already exists for issue #${issueNumber}`, {
        issueNumber,
        data: { path: worktreePath, branch: issueBranch },
      });
      const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);
      const baseCommit = await this.getBaseCommit(worktreePath);
      return { issueNumber, path: worktreePath, branch: issueBranch, exists: true, baseCommit, syncedAgentFiles };
    }

    // Resolve base commit from origin or local
    const baseCommit = await this.git.revparse([`origin/${this.baseBranch}`]).catch(async () => {
      return this.git.revparse([this.baseBranch]);
    });

    // Delegate dependency branch creation and merge to DependencyBranchMerger
    const depsHead = await this.dependencyBranchMerger.mergeDependencies(
      issueNumber,
      deps,
      baseCommit,
      this.worktreeRoot,
      resolveMergeConflict,
    );

    // Create the issue branch from the HEAD of the deps branch
    const branchExists = await this.branchExistsLocal(issueBranch);
    if (!branchExists) {
      await this.git.branch([issueBranch, depsHead.trim()]);
    }

    // Create worktree for the issue branch
    await this.git.raw(['worktree', 'add', worktreePath, issueBranch]);

    await this.agentFileSync.initCadreDir(worktreePath, issueNumber);
    const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);

    this.logger.info(`Provisioned worktree with deps for issue #${issueNumber}`, {
      issueNumber,
      data: { path: worktreePath, branch: issueBranch, depsBranch, baseCommit: baseCommit.trim().slice(0, 8) },
    });

    return {
      issueNumber,
      path: worktreePath,
      branch: issueBranch,
      exists: true,
      baseCommit: baseCommit.trim(),
      syncedAgentFiles,
    };
  }

  /**
   * Create a worktree from an existing remote branch (e.g. resumed from another machine).
   * Fetches the remote branch, adds a git worktree checked out to it, and returns a WorktreeInfo.
   * If the worktree directory already exists and is valid, returns it without re-provisioning.
   */
  async provisionFromBranch(issueNumber: number, branch: string): Promise<WorktreeInfo> {
    const worktreePath = this.getWorktreePath(issueNumber);

    // Return existing worktree if already on disk
    if (await exists(worktreePath)) {
      this.logger.info(`Worktree already exists for issue #${issueNumber}`, {
        issueNumber,
        data: { path: worktreePath, branch },
      });

      const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);
      const baseCommit = await this.getBaseCommit(worktreePath);
      return {
        issueNumber,
        path: worktreePath,
        branch,
        exists: true,
        baseCommit,
        syncedAgentFiles,
      };
    }

    // Fetch the remote branch so it's available locally
    await this.git.fetch('origin', branch);
    this.logger.debug(`Fetched origin/${branch}`, { issueNumber });

    // Add the worktree checked out to the remote branch
    await ensureDir(this.worktreeRoot);
    // Use -B so the worktree is checked out on a local branch (not detached HEAD),
    // enabling plain `git push origin HEAD` to work correctly afterwards.
    await this.git.raw(['worktree', 'add', '-B', branch, worktreePath, `origin/${branch}`]);

    // Bootstrap the worktree's .cadre/ directory
    await this.agentFileSync.initCadreDir(worktreePath, issueNumber);
    const syncedAgentFiles = await this.agentFileSync.syncAgentFiles(worktreePath, issueNumber);

    const baseCommit = await this.getBaseCommit(worktreePath);

    this.logger.info(`Provisioned worktree from branch ${branch} for issue #${issueNumber}`, {
      issueNumber,
      data: { path: worktreePath, branch, baseCommit: baseCommit.slice(0, 8) },
    });

    return {
      issueNumber,
      path: worktreePath,
      branch,
      exists: true,
      baseCommit,
      syncedAgentFiles,
    };
  }

  /**
   * Fetch the latest base branch from origin.
   * Call this before `provision()` to ensure the remote ref is up to date.
   */
  async prefetch(): Promise<void> {
    try {
      await this.git.fetch('origin', this.baseBranch);
      this.logger.debug(`Fetched origin/${this.baseBranch}`);
    } catch (err) {
      this.logger.warn(`Failed to fetch origin/${this.baseBranch}, continuing with local`);
    }
  }

  /**
   * Provision a fresh ephemeral directory for the dependency-analyst agent,
   * unique to this run via `runId`.
   */
  async provisionForDependencyAnalyst(runId: string): Promise<string> {
    const agentDir = join(tmpdir(), `cadre-dag-${runId}`);
    await ensureDir(agentDir);

    this.logger.info(`Creating dag-resolver temp dir for dependency-analyst agent (run ${runId})`);

    // Initialise a minimal git repo so the Copilot CLI recognises this
    // directory as a self-contained project root containing .github/agents/.
    const tempGit = simpleGit(agentDir);
    await tempGit.init();
    await tempGit.addConfig('user.email', 'cadre@localhost');
    await tempGit.addConfig('user.name', 'cadre');

    await this.agentFileSync.syncAgentFiles(agentDir, 0);
    return agentDir;
  }

  /**
   * List all active CADRE worktrees.
   */
  async listActive(): Promise<WorktreeInfo[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split('\n\n').filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let path = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length);
        }
        if (line.startsWith('branch ')) {
          branch = line.slice('branch refs/heads/'.length);
        }
      }

      // Only include worktrees managed by CADRE
      if (path && path.startsWith(this.worktreeRoot)) {
        const issueMatch = path.match(/issue-(\d+)\/?$/);
        if (issueMatch) {
          const issueNumber = parseInt(issueMatch[1], 10);
          const baseCommit = await this.getBaseCommit(path).catch(() => '');
          worktrees.push({
            issueNumber,
            path,
            branch,
            exists: true,
            baseCommit,
            syncedAgentFiles: [],
          });
        }
      }
    }

    return worktrees;
  }

  /**
   * Check if a worktree for this issue already exists.
   */
  async exists(issueNumber: number): Promise<boolean> {
    const worktreePath = this.getWorktreePath(issueNumber);
    return exists(worktreePath);
  }

  /**
   * Rebase the worktree's branch onto the latest base branch.
   * Aborts automatically on conflict and returns success=false.
   * For conflict resolution support, use rebaseStart / rebaseContinue / rebaseAbort.
   */
  async rebase(issueNumber: number): Promise<{ success: boolean; conflicts?: string[] }> {
    const result = await this.rebaseStart(issueNumber);
    if (result.status === 'clean') return { success: true };

    await this.rebaseAbort(issueNumber);
    return { success: false, conflicts: result.conflictedFiles };
  }

  /**
   * Fetch and start a rebase of the worktree branch onto the latest base branch.
   * Unlike rebase(), this does NOT abort on conflict — it leaves the rebase
   * paused so an agent can resolve the conflicted files, after which
   * rebaseContinue() should be called.
   */
  async rebaseStart(
    issueNumber: number,
  ): Promise<
    | { status: 'clean' }
    | { status: 'conflict'; conflictedFiles: string[]; worktreePath: string }
  > {
    const worktreePath = this.getWorktreePath(issueNumber);
    const worktreeGit = simpleGit(worktreePath);

    // Detect if a rebase from a previous run is already paused in this worktree.
    const rawGitDir = (await worktreeGit.raw(['rev-parse', '--git-dir'])).trim();
    const gitDir = rawGitDir.startsWith('/') ? rawGitDir : join(worktreePath, rawGitDir);
    const alreadyPaused =
      (await exists(join(gitDir, 'rebase-merge'))) ||
      (await exists(join(gitDir, 'rebase-apply')));

    if (alreadyPaused) {
      const conflictedFiles = await this.getConflictedFiles(worktreePath);
      this.logger.warn(
        `Issue #${issueNumber}: rebase is already paused from a previous run — resuming with ${conflictedFiles.length} conflicted file(s) (fetch skipped)`,
        { issueNumber, data: { conflictedFiles, gitDir } },
      );
      return { status: 'conflict', conflictedFiles, worktreePath };
    }

    await worktreeGit.fetch('origin', this.baseBranch);

    try {
      await worktreeGit.rebase([`origin/${this.baseBranch}`]);
      this.logger.info(`Rebased worktree cleanly for issue #${issueNumber}`, { issueNumber });
      return { status: 'clean' };
    } catch {
      // Rebase is paused at the first conflicting commit — do NOT abort.
      const conflictedFiles = await this.getConflictedFiles(worktreePath);
      this.logger.info(
        `Rebase paused for issue #${issueNumber}: ${conflictedFiles.length} conflicted file(s)`,
        { issueNumber, data: { conflictedFiles } },
      );
      return { status: 'conflict', conflictedFiles, worktreePath };
    }
  }

  /**
   * Stage all changes and continue a paused rebase.
   * Call this after an agent has resolved the conflicted files left by rebaseStart().
   */
  async rebaseContinue(
    issueNumber: number,
  ): Promise<{ success: boolean; error?: string; conflictedFiles?: string[] }> {
    const worktreePath = this.getWorktreePath(issueNumber);
    const worktreeGit = simpleGit(worktreePath);

    try {
      await worktreeGit.raw(['add', '-A']);
      // GIT_EDITOR=true prevents git from opening an editor for the commit message.
      await worktreeGit.env({ ...process.env, GIT_EDITOR: 'true' }).rebase(['--continue']);
      this.logger.info(`Rebase continued successfully for issue #${issueNumber}`, { issueNumber });
      return { success: true };
    } catch (err) {
      // Check whether there are still unresolved conflict markers remaining.
      const stillConflicted = await this.getConflictedFiles(worktreePath);
      if (stillConflicted.length > 0) {
        this.logger.error(
          `Rebase --continue failed for issue #${issueNumber}: ${stillConflicted.length} file(s) still have conflict markers: ${stillConflicted.join(', ')}`,
          { issueNumber, data: { conflictedFiles: stillConflicted } },
        );
        return {
          success: false,
          error: `Conflicts remain after resolution attempt: ${stillConflicted.join(', ')}`,
          conflictedFiles: stillConflicted,
        };
      }
      // If the agent already completed the rebase (ran its own git rebase --continue),
      // git reports "no rebase in progress" — treat this as success.
      const errStr = String(err);
      if (errStr.includes('no rebase in progress')) {
        this.logger.info(
          `Rebase for issue #${issueNumber} was already completed by the agent — treating as success`,
          { issueNumber },
        );
        return { success: true };
      }
      // Unexpected git error (e.g. new conflicts on the next commit in the rebase queue).
      this.logger.error(
        `Rebase --continue failed for issue #${issueNumber}: ${err}`,
        { issueNumber },
      );
      return { success: false, error: String(err) };
    }
  }

  /**
   * Abort a paused rebase, restoring the worktree to its pre-rebase state.
   */
  async rebaseAbort(issueNumber: number): Promise<void> {
    const worktreePath = this.getWorktreePath(issueNumber);
    const worktreeGit = simpleGit(worktreePath);
    try {
      await worktreeGit.rebase(['--abort']);
      this.logger.info(`Rebase aborted for issue #${issueNumber}`, { issueNumber });
    } catch {
      // May already be aborted / not in a rebase state.
    }
  }

  /**
   * Resolve the branch name for an issue using branchTemplate.
   */
  resolveBranchName(issueNumber: number, issueTitle?: string): string {
    let branch = this.branchTemplate
      .replace('{issue}', String(issueNumber))
      .replace('{title}', issueTitle ?? '');

    // Sanitize: lowercase, replace non-safe chars with hyphens, collapse multiple hyphens
    branch = branch
      .toLowerCase()
      .replace(/[^a-z0-9/\-_]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/-$/, '')
      .replace(/^-/, '');

    // Truncate to a reasonable length
    if (branch.length > 100) {
      branch = branch.slice(0, 100).replace(/-$/, '');
    }

    return branch;
  }

  /**
   * Get the worktree directory path for an issue.
   */
  public getWorktreePath(issueNumber: number): string {
    return this.worktreeCleaner.getWorktreePath(issueNumber);
  }

  /**
   * Remove a worktree after the PR is created.
   */
  async remove(issueNumber: number): Promise<void> {
    return this.worktreeCleaner.remove(issueNumber);
  }

  /**
   * Remove an ephemeral directory created by `provisionForDependencyAnalyst`.
   */
  async removeWorktreeAtPath(worktreePath: string): Promise<void> {
    return this.worktreeCleaner.removeWorktreeAtPath(worktreePath);
  }

  /**
   * Return the list of files currently in an unresolved merge-conflict state
   * inside the given worktree path.
   */
  private async getConflictedFiles(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      const output = await worktreeGit.raw(['diff', '--name-only', '--diff-filter=U']);
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Check if a branch exists locally.
   */
  private async branchExistsLocal(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch {
      return false;
    }
  }

  /**
   * Get the merge-base commit between the worktree HEAD and the base branch.
   */
  private async getBaseCommit(worktreePath: string): Promise<string> {
    try {
      const worktreeGit = simpleGit(worktreePath);
      for (const ref of [`origin/${this.baseBranch}`, this.baseBranch]) {
        const result = await worktreeGit.raw(['merge-base', 'HEAD', ref]).catch(() => '');
        if (result.trim()) return result.trim();
      }
      // Fall back to HEAD for newly created worktrees that have no commits yet
      const head = await worktreeGit.revparse(['HEAD']);
      return head.trim();
    } catch {
      return '';
    }
  }
}
