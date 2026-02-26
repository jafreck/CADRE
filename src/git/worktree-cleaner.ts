import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { SimpleGit } from 'simple-git';
import { Logger } from '../logging/logger.js';
import { exists } from '../util/fs.js';

/**
 * Handles removal of git worktrees and ephemeral directories.
 */
export class WorktreeCleaner {
  constructor(
    private readonly git: SimpleGit,
    private readonly worktreeRoot: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Get the worktree directory path for an issue.
   */
  getWorktreePath(issueNumber: number): string {
    return join(this.worktreeRoot, `issue-${issueNumber}`);
  }

  /**
   * Remove a worktree after the PR is created.
   * No-op when the path does not exist.
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
   * Remove an ephemeral directory (e.g. created by `provisionForDependencyAnalyst`).
   * Non-fatal on failure — logs a warning instead of throwing.
   */
  async removeWorktreeAtPath(worktreePath: string): Promise<void> {
    try {
      await rm(worktreePath, { recursive: true, force: true });
      this.logger.debug(`Removed ephemeral dag-resolver dir at ${worktreePath}`);
    } catch (err) {
      this.logger.warn(`Could not remove ephemeral dag-resolver dir at ${worktreePath}: ${err}`);
    }
  }
}
