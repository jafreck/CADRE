import { simpleGit, type SimpleGit } from 'simple-git';
import { join, basename } from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { Logger } from '../logging/logger.js';
import { exists, ensureDir } from '../util/fs.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';

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
}

/**
 * Manages the lifecycle of git worktrees — one per issue.
 */
export class WorktreeManager {
  private readonly git: SimpleGit;

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

      await this.syncAgentFiles(worktreePath, issueNumber);
      const baseCommit = await this.getBaseCommit(worktreePath);
      return {
        issueNumber,
        path: worktreePath,
        branch,
        exists: true,
        baseCommit,
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

      await this.initCadreDir(worktreePath, issueNumber);
      await this.syncAgentFiles(worktreePath, issueNumber);

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
    await this.initCadreDir(worktreePath, issueNumber);
    await this.syncAgentFiles(worktreePath, issueNumber);

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

      await this.syncAgentFiles(worktreePath, issueNumber);
      const baseCommit = await this.getBaseCommit(worktreePath);
      return {
        issueNumber,
        path: worktreePath,
        branch,
        exists: true,
        baseCommit,
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
    await this.initCadreDir(worktreePath, issueNumber);
    await this.syncAgentFiles(worktreePath, issueNumber);

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
   * Bootstrap the worktree's `.cadre/` directory and add it to the worktree's
   * private git exclude file (`{git-dir}/info/exclude`) so it is never tracked
   * or accidentally committed — without touching the repo's `.gitignore`.
   */
  private async initCadreDir(worktreePath: string, issueNumber: number): Promise<void> {
    const cadreDir = join(worktreePath, '.cadre');
    await ensureDir(cadreDir);

    // Ensure cadre's tasks scratch dir exists too so agents can write there
    await ensureDir(join(cadreDir, 'tasks'));

    // Write `.cadre/` to the worktree-local git exclude instead of .gitignore
    // so the exclusion is never staged or committed.
    try {
      const gitDir = (await this.git.raw(['rev-parse', '--git-dir'])).trim();
      const excludePath = join(
        gitDir.startsWith('/') ? gitDir : join(worktreePath, gitDir),
        'info',
        'exclude',
      );
      await ensureDir(join(excludePath, '..'));
      const { readFile: readFileNode, writeFile } = await import('node:fs/promises');
      const existing = await readFileNode(excludePath, 'utf-8').catch(() => '');
      if (!existing.split('\n').some((line) => line.trim() === '.cadre/')) {
        const updated =
          existing === '' || existing.endsWith('\n')
            ? `${existing}.cadre/\n`
            : `${existing}\n.cadre/\n`;
        await writeFile(excludePath, updated, 'utf-8');
        this.logger.debug('Added .cadre/ to worktree git exclude', { issueNumber });
      }
    } catch (err) {
      // Non-fatal: belt-and-suspenders; CommitManager.unstageArtifacts also guards .cadre/
      this.logger.debug('Could not write worktree git exclude; relying on unstageArtifacts', { issueNumber });
    }
  }

  /**
   * Copy agent files from agentDir into the worktree's agent directory.
   * Source files in agentDir are always plain `{name}.md` with no frontmatter.
   *
   * - **Copilot**: reads `{name}.md`, injects YAML frontmatter, writes
   *   `{name}.agent.md` into `.github/agents/` (the format Copilot CLI expects).
   * - **Claude**: copies `{name}.md` as-is into `.claude/agents/`.
   *
   * No-op if agentDir is not configured or does not exist.
   */
  private async syncAgentFiles(worktreePath: string, issueNumber: number): Promise<void> {
    if (!this.agentDir) return;

    if (!(await exists(this.agentDir))) {
      this.logger.debug(`agentDir ${this.agentDir} does not exist — skipping agent sync`, { issueNumber });
      return;
    }

    const destDir =
      this.backend === 'claude'
        ? join(worktreePath, '.claude', 'agents')
        : join(worktreePath, '.github', 'agents');
    await ensureDir(destDir);

    const entries = await readdir(this.agentDir);
    const sourceFiles = entries.filter((f) => f.endsWith('.md') && !f.endsWith('.agent.md'));
    let syncCount = 0;

    for (const file of sourceFiles) {
      const agentName = file.replace(/\.md$/, '');
      const srcPath = join(this.agentDir!, file);

      if (this.backend === 'claude') {
        // Claude expects plain .md files
        await writeFile(join(destDir, file), await readFile(srcPath, 'utf-8'), 'utf-8');
      } else {
        // Copilot expects {name}.agent.md with YAML frontmatter
        const definition = AGENT_DEFINITIONS.find((d) => d.name === agentName);
        const displayName = agentName
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        const description = definition?.description ?? displayName;
        const frontmatter = [
          '---',
          `name: ${displayName}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          'tools: ["read", "edit", "search", "execute"]',
          '---',
          '',
        ].join('\n');
        const body = await readFile(srcPath, 'utf-8');
        const destFile = `${agentName}.agent.md`;
        await writeFile(join(destDir, destFile), frontmatter + body, 'utf-8');
      }
      syncCount++;
    }

    if (syncCount > 0) {
      this.logger.debug(
        `Synced ${syncCount} agent file(s) from ${this.agentDir} → ${destDir}`,
        { issueNumber },
      );
    }
  }

  /**
   * Remove a worktree after the PR is created.
   */
  async remove(issueNumber: number): Promise<void> {
    const worktreePath = this.getWorktreePath(issueNumber);

    if (!(await exists(worktreePath))) {
      this.logger.debug(`Worktree for issue #${issueNumber} already removed`, { issueNumber });
      return;
    }

    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
      this.logger.info(`Removed worktree for issue #${issueNumber}`, { issueNumber });
    } catch (err) {
      this.logger.error(`Failed to remove worktree for issue #${issueNumber}: ${err}`, {
        issueNumber,
      });
      throw err;
    }
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
    // `git rev-parse --git-dir` returns the worktree-specific git directory
    // (e.g. /repo/.git/worktrees/issue-47). We check for rebase-merge / rebase-apply
    // to short-circuit the fetch + rebase and resume from the existing state.
    // Without this check, calling `git rebase` while a rebase is already in
    // progress throws immediately with "A rebase operation is in progress", which
    // the catch block would silently absorb while the branch is NOT brought up to
    // date with the base branch.
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
        // Log at error level — a silent return here would cause the orchestrator
        // to see only the generic error string with no file context.
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
  private getWorktreePath(issueNumber: number): string {
    return join(this.worktreeRoot, `issue-${issueNumber}`);
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
      const head = await worktreeGit.revparse(['HEAD']);
      return head.trim();
    } catch {
      return '';
    }
  }
}
