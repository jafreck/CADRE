import { simpleGit, type SimpleGit } from 'simple-git';
import type { CadreConfig } from '../config/schema.js';
import { Logger } from '../logging/logger.js';

/**
 * Manages git commit operations within a worktree.
 */
export class CommitManager {
  private readonly git: SimpleGit;

  constructor(
    private readonly worktreePath: string,
    private readonly config: CadreConfig['commits'],
    private readonly logger: Logger,
  ) {
    this.git = simpleGit(worktreePath);
  }

  /**
   * Stage all changes and create a commit.
   * @param message - Commit message (auto-prefixed with conventional type if configured)
   * @param issueNumber - For linking (e.g. "Refs #42")
   * @param type - Conventional commit type (feat, fix, chore, etc.)
   */
  async commit(message: string, issueNumber: number, type?: string): Promise<string> {
    // Stage all changes
    await this.git.add(['-A']);

    // Unstage cadre-internal artifacts so they never appear in commits.
    // .gitignore handles this in fresh worktrees, but this is a belt-and-suspenders
    // guard for any artifacts that slipped through (e.g. before .gitignore was written).
    await this.unstageArtifacts(issueNumber);

    // Check if there's anything to commit
    const status = await this.git.status();
    if (status.staged.length === 0) {
      this.logger.debug('Nothing to commit — working tree clean', { issueNumber });
      return '';
    }

    // Format message
    const fullMessage = this.formatMessage(message, issueNumber, type);

    // Build commit options
    const commitOpts: string[] = ['-m', fullMessage];
    if (this.config.sign) {
      commitOpts.push('-S');
    }

    const result = await this.git.commit(fullMessage, undefined, {
      '--no-verify': null,
      ...(this.config.sign ? { '-S': null } : {}),
    });

    const sha = result.commit || '';
    this.logger.info(`Committed: ${sha.slice(0, 8)} — ${fullMessage.split('\n')[0]}`, {
      issueNumber,
      data: { sha, filesChanged: status.staged.length },
    });

    return sha;
  }

  /**
   * Unstage any cadre internal artifact files that should never be committed.
   * Covers the `.cadre/` directory and common top-level scratch patterns.
   */
  private async unstageArtifacts(issueNumber: number): Promise<void> {
    const artifactPatterns = ['.cadre/', 'task-*.md'];
    try {
      // `git restore --staged` silently succeeds even if the path doesn't exist
      await this.git.raw(['restore', '--staged', '--', ...artifactPatterns]);
    } catch {
      // Non-fatal: if restore fails (e.g. old git version), log and continue
      this.logger.debug('Could not unstage artifact patterns; continuing', { issueNumber });
    }
  }

  /**
   * Stage specific files and commit.
   */
  async commitFiles(files: string[], message: string, issueNumber: number): Promise<string> {
    if (files.length === 0) return '';

    await this.git.add(files);

    const status = await this.git.status();
    if (status.staged.length === 0) {
      this.logger.debug('Nothing to commit after staging specific files', { issueNumber });
      return '';
    }

    const fullMessage = this.formatMessage(message, issueNumber);
    const result = await this.git.commit(fullMessage, undefined, {
      '--no-verify': null,
    });

    return result.commit || '';
  }

  /**
   * Push the current branch to origin.
   * @param force - Use --force-with-lease.
   * @param branch - The branch name to push to on origin (`HEAD:refs/heads/<branch>`).
   */
  async push(force = false, branch: string): Promise<void> {
    const args = ['push', 'origin', `HEAD:refs/heads/${branch}`];
    if (force) {
      args.push('--force-with-lease');
    }
    args.push('--set-upstream');

    await this.git.raw(args);
    this.logger.info('Pushed to origin');
  }

  /**
   * Squash all commits on the branch into one (relative to base).
   */
  async squash(baseCommit: string, message: string): Promise<string> {
    // Soft reset to base commit (keeps changes staged)
    await this.git.reset(['--soft', baseCommit]);
    // Create a single commit
    const result = await this.git.commit(message, undefined, {
      '--no-verify': null,
    });
    this.logger.info(`Squashed commits into ${result.commit}`);
    return result.commit || '';
  }

  /**
   * Get the list of changed files (staged + unstaged).
   */
  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map((r) => r.to),
      ...status.not_added,
    ];
  }

  /**
   * Check if the working tree is clean.
   */
  async isClean(): Promise<boolean> {
    const status = await this.git.status();
    return status.isClean();
  }

  /**
   * Get the diff introduced by the last commit (HEAD~1..HEAD).
   * Falls back to `git show HEAD` if HEAD~1 does not exist (i.e., first commit).
   */
  async getTaskDiff(): Promise<string> {
    try {
      return await this.git.diff(['HEAD~1..HEAD']);
    } catch {
      // HEAD~1 does not exist — this is the first commit; show its full content
      return this.git.raw(['show', 'HEAD']);
    }
  }

  /**
   * Get the diff of all changes from the base commit to HEAD.
   */
  async getDiff(baseCommit?: string): Promise<string> {
    if (baseCommit) {
      return this.git.diff([`${baseCommit}..HEAD`]);
    }
    return this.git.diff();
  }

  /**
   * Format a commit message with conventional commit prefix and issue reference.
   */
  private formatMessage(message: string, issueNumber: number, type?: string): string {
    let formatted = message;

    // Add conventional commit prefix if configured and not already present
    if (this.config.conventional && type && !message.match(/^(feat|fix|chore|docs|refactor|test|style|perf|ci|build)\(/)) {
      formatted = `${type}(#${issueNumber}): ${message}`;
    }

    // Add issue reference if not already in the message
    if (!formatted.includes(`#${issueNumber}`)) {
      formatted += `\n\nRefs #${issueNumber}`;
    }

    return formatted;
  }
}
