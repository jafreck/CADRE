import { simpleGit, type SimpleGit } from 'simple-git';
import type { CadreConfig } from '../config/schema.js';
import { Logger } from '../logging/logger.js';
import { formatCommitSubject } from '../util/title-format.js';

/**
 * Manages git commit operations within a worktree.
 */
export class CommitManager {
  private readonly git: SimpleGit;

  constructor(
    private readonly worktreePath: string,
    private readonly config: CadreConfig['commits'],
    private readonly logger: Logger,
    /**
     * Worktree-relative paths of agent instruction files written by
     * `WorktreeManager.syncAgentFiles`.  Only these exact files are unstaged
     * before every commit — the target repo's own agent files are untouched.
     */
    private readonly syncedAgentFiles: string[] = [],
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
   *
   * Core cadre directories (`.cadre/`, scratch `task-*.md` files) are always
   * excluded.  Agent instruction files are identified by the exact paths passed
   * in at construction time from `WorktreeManager.syncAgentFiles`, so only
   * those specific files are unstaged — the target repo's own agent files
   * in the same directories are completely untouched.
   *
   * Each pattern is restored individually so that a pathspec miss on one
   * pattern (e.g. no `task-*.md` files are staged) does not cause git to
   * abort the whole command and leave the agent files still staged.
   */
  private async unstageArtifacts(issueNumber: number): Promise<void> {
    const artifactPatterns = ['.cadre/', 'task-*.md', ...this.syncedAgentFiles];
    for (const pattern of artifactPatterns) {
      // `git restore --staged` may fail with a pathspec error when the pattern
      // matches nothing — catch individually so one miss doesn't block the rest.
      await this.git.raw(['restore', '--staged', '--', pattern]).catch(() => {});
    }
    this.logger.debug(
      `Unstaged ${artifactPatterns.length} artifact pattern(s)`,
      { issueNumber },
    );
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
   * Replay every commit between `baseCommit` and HEAD, removing cadre-internal
   * artifact files from each one, while preserving the original commit message,
   * author, and timestamps.
   *
   * Algorithm per commit:
   *   1. `cherry-pick --no-commit <sha>` — stage that commit's diff without advancing HEAD.
   *   2. `restore --staged` + `restore` — drop cadre artefacts from index and working tree.
   *   3a. If nothing remains staged the commit consisted purely of cadre files — drop it.
   *   3b. Otherwise `commit -C <sha>` — create a new commit reusing the original
   *       author name, email, date, and message verbatim.
   *
   * This preserves individual commit granularity in the PR, unlike a squash approach.
   */
  async stripCadreFiles(baseCommit: string): Promise<void> {
    const logOutput = (
      await this.git.raw(['log', '--format=%H', '--reverse', `${baseCommit}..HEAD`])
    ).trim();

    if (!logOutput) {
      this.logger.debug('stripCadreFiles: no commits between base and HEAD');
      return;
    }

    const shas = logOutput.split('\n').filter(Boolean);
    const cadrePatterns = ['.cadre/', 'task-*.md', ...this.syncedAgentFiles];

    // Hard-reset to the branch point; commits will be replayed one by one.
    await this.git.reset(['--hard', baseCommit]);

    let rewritten = 0;
    let dropped = 0;

    for (const sha of shas) {
      // Stage this commit's diff without advancing HEAD.
      // Ignore exit code: conflicts are acceptable since we remove the offending files next.
      await this.git.raw(['cherry-pick', '--no-commit', sha]).catch(() => {});

      // Remove cadre artefacts from index and working tree.
      // Run each pattern individually — a pathspec miss on one (e.g. no
      // task-*.md files in this commit) must not abort the whole restore.
      for (const pattern of cadrePatterns) {
        await this.git.raw(['restore', '--staged', '--', pattern]).catch(() => {});
        await this.git.raw(['restore', '--', pattern]).catch(() => {});
      }

      const status = await this.git.status();
      if (status.staged.length === 0) {
        // Commit consisted entirely of cadre files — drop it and clean up.
        await this.git.reset(['--hard', 'HEAD']).catch(() => {});
        // --quit removes CHERRY_PICK_HEAD without reverting index/working tree.
        await this.git.raw(['cherry-pick', '--quit']).catch(() => {});
        dropped++;
        this.logger.debug(`stripCadreFiles: dropped cadre-only commit ${sha.slice(0, 8)}`);
        continue;
      }

      // -C reuses the original commit's author name, email, timestamp, and message.
      await this.git.raw(['commit', '-C', sha]);
      rewritten++;
    }

    this.logger.info(
      `stripCadreFiles: rewrote ${rewritten} commit(s), dropped ${dropped} cadre-only commit(s)`,
    );
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
    return formatCommitSubject(message, issueNumber, type, this.config.conventional);
  }
}
