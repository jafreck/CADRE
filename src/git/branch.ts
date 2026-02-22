import { simpleGit, type SimpleGit } from 'simple-git';
import { Logger } from '../logging/logger.js';

/**
 * Manages git branch operations.
 */
export class BranchManager {
  private readonly git: SimpleGit;

  constructor(
    private readonly repoPath: string,
    private readonly logger: Logger,
  ) {
    this.git = simpleGit(repoPath);
  }

  /**
   * Create a branch from a base ref.
   */
  async create(branchName: string, baseRef: string): Promise<void> {
    await this.git.branch([branchName, baseRef]);
    this.logger.debug(`Created branch ${branchName} from ${baseRef}`);
  }

  /**
   * Delete a local branch.
   */
  async deleteLocal(branchName: string): Promise<void> {
    try {
      await this.git.branch(['-D', branchName]);
      this.logger.debug(`Deleted local branch ${branchName}`);
    } catch (err) {
      this.logger.warn(`Failed to delete local branch ${branchName}: ${err}`);
    }
  }

  /**
   * Delete a remote branch.
   */
  async deleteRemote(branchName: string): Promise<void> {
    try {
      await this.git.push(['origin', '--delete', branchName]);
      this.logger.debug(`Deleted remote branch ${branchName}`);
    } catch (err) {
      this.logger.warn(`Failed to delete remote branch ${branchName}: ${err}`);
    }
  }

  /**
   * Check if a branch exists locally.
   */
  async existsLocal(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch {
      return false;
    }
  }

  /**
   * Check if a branch exists on origin.
   */
  async existsRemote(branchName: string): Promise<boolean> {
    try {
      const result = await this.git.raw(['ls-remote', '--heads', 'origin', branchName]);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the current HEAD commit SHA.
   */
  async getHead(worktreePath: string): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);
    const head = await worktreeGit.revparse(['HEAD']);
    return head.trim();
  }
}
