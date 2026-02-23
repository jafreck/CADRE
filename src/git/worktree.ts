import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { Logger } from '../logging/logger.js';
import { exists, ensureDir, readFileOrNull, atomicWriteFile } from '../util/fs.js';

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
   * Bootstrap the worktree's `.cadre/` directory and ensure it is gitignored.
   * This must run once immediately after the worktree is created so that cadre
   * internal artifacts never get picked up by `git add -A`.
   */
  private async initCadreDir(worktreePath: string, issueNumber: number): Promise<void> {
    const cadreDir = join(worktreePath, '.cadre');
    await ensureDir(cadreDir);

    // Ensure cadre's tasks scratch dir exists too so agents can write there
    await ensureDir(join(cadreDir, 'tasks'));

    // Append `.cadre/` to the worktree's .gitignore if not already present
    const gitignorePath = join(worktreePath, '.gitignore');
    const existing = (await readFileOrNull(gitignorePath)) ?? '';
    if (!existing.split('\n').some((line) => line.trim() === '.cadre/')) {
      const updated = existing.endsWith('\n') || existing === ''
        ? `${existing}.cadre/\n`
        : `${existing}\n.cadre/\n`;
      await atomicWriteFile(gitignorePath, updated);
      this.logger.debug('Added .cadre/ to worktree .gitignore', { issueNumber });
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
   */
  async rebase(issueNumber: number): Promise<{ success: boolean; conflicts?: string[] }> {
    const worktreePath = this.getWorktreePath(issueNumber);
    const worktreeGit = simpleGit(worktreePath);

    try {
      // Fetch latest
      await worktreeGit.fetch('origin', this.baseBranch);
      // Attempt rebase
      await worktreeGit.rebase([`origin/${this.baseBranch}`]);
      this.logger.info(`Rebased worktree for issue #${issueNumber}`, { issueNumber });
      return { success: true };
    } catch (err) {
      // Abort the rebase on conflict
      try {
        await worktreeGit.rebase(['--abort']);
      } catch {
        // May already be aborted
      }

      const errorStr = String(err);
      const conflictMatch = errorStr.match(/CONFLICT.*?: (.+)/g);
      const conflicts = conflictMatch ?? [errorStr];

      this.logger.warn(`Rebase failed for issue #${issueNumber}`, {
        issueNumber,
        data: { conflicts },
      });

      return { success: false, conflicts };
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
