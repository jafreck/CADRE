import { simpleGit, type SimpleGit } from 'simple-git';
import type { CadreConfig } from '../config/schema.js';
import { Logger } from '@cadre/framework/core';
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
     * Already-tracked paths are excluded by `syncAgentFiles` before being passed here,
     * so only truly ephemeral (untracked) cadre-injected files are listed.
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
   * Remove cadre-internal artifact files from all commits between `baseCommit` and HEAD.
   *
   * Uses a single-diff squash approach rather than per-commit cherry-pick replay.
   * This eliminates the class of sequential replay conflicts that occur when
   * cadre artifacts are interleaved across multiple commits touching the same files.
   *
   * Algorithm:
   *   1. Compute the full diff `baseCommit..HEAD`.
   *   2. Soft-reset to `baseCommit` (keeps all changes staged).
   *   3. Unstage cadre artifact files from the index.
   *   4. Remove cadre artifacts from the working tree.
   *   5. Create a single commit with the remaining changes, using the last
   *      commit's message.
   *
   * Trade-off: individual commit granularity is lost, but since these PRs are
   * squash-merged anyway the individual commits don't survive.  The benefit is
   * zero cherry-pick conflicts.
   */
  async stripCadreFiles(
    baseCommit: string,
    _resolveConflicts?: (conflictedFiles: string[], commitSha: string) => Promise<void>,
  ): Promise<void> {
    const logOutput = (
      await this.git.raw(['log', '--format=%H', '--reverse', `${baseCommit}..HEAD`])
    ).trim();

    if (!logOutput) {
      this.logger.debug('stripCadreFiles: no commits between base and HEAD');
      return;
    }

    const shas = logOutput.split('\n').filter(Boolean);
    const lastSha = shas[shas.length - 1];
    const cadrePatterns = ['.cadre/', 'task-*.md', ...this.syncedAgentFiles];

    // Soft-reset to the branch point — all file changes remain staged.
    await this.git.reset(['--soft', baseCommit]);

    // Unstage and remove cadre artifact files.
    for (const pattern of cadrePatterns) {
      await this.git.raw(['restore', '--staged', '--', pattern]).catch(() => {});
      await this.git.raw(['checkout', 'HEAD', '--', pattern]).catch(() => {});
    }
    // Also clean up any untracked cadre files from the working tree.
    for (const pattern of cadrePatterns) {
      await this.git.raw(['clean', '-fd', '--', pattern]).catch(() => {});
    }

    const status = await this.git.status();
    if (status.staged.length === 0) {
      // All changes were cadre-only — hard-reset back to base.
      await this.git.reset(['--hard', baseCommit]);
      this.logger.info(
        `stripCadreFiles: all ${shas.length} commit(s) were cadre-only — dropped`,
      );
      return;
    }

    // Create a single commit reusing the last original commit's metadata.
    await this.git.raw(['commit', '-C', lastSha]);

    this.logger.info(
      `stripCadreFiles: squashed ${shas.length} commit(s) into 1, stripping cadre artifacts`,
    );
  }

  private getConflictedFiles(status: Awaited<ReturnType<SimpleGit['status']>>): string[] {
    const fromStatus = Array.isArray(status.conflicted)
      ? status.conflicted.filter((file): file is string => typeof file === 'string' && file.length > 0)
      : [];

    const fromFiles = Array.isArray(status.files)
      ? status.files
          .filter((file) => file.index === 'U' || file.working_dir === 'U')
          .map((file) => file.path)
          .filter((file): file is string => typeof file === 'string' && file.length > 0)
      : [];

    return [...new Set([...fromStatus, ...fromFiles])];
  }

  /**
   * Defence-in-depth pre-push check: verify the diff between `baseCommit` and
   * HEAD contains no cadre artifact files.  If any are found, unstage them and
   * amend the commit so they are never pushed to the remote.
   *
   * This catches artifacts that survive `stripCadreFiles` — for example when a
   * rebase onto a base branch that already contains `.cadre/` re-introduces the
   * files, or when an agent independently commits them.
   */
  async ensureNoCadreArtifactsInDiff(baseCommit: string): Promise<void> {
    const cadrePatterns = ['.cadre/', 'task-', ...this.syncedAgentFiles];
    const isCadreArtifact = (f: string) =>
      cadrePatterns.some((p) => {
        if (p.includes('*')) {
          // Simple glob: 'task-*.md' → startsWith('task-')
          const prefix = p.split('*')[0];
          return f.startsWith(prefix) || f.includes(`/${prefix}`);
        }
        return f.startsWith(p) || f.includes(`/${p}`);
      });

    const diffOutput = await this.git.diff(['--name-only', `${baseCommit}..HEAD`]);
    const changedFiles = diffOutput.trim().split('\n').filter(Boolean);
    const artifacts = changedFiles.filter(isCadreArtifact);

    if (artifacts.length === 0) return;

    this.logger.warn(
      `Pre-push guard: found ${artifacts.length} cadre artifact(s) in diff — stripping: ${artifacts.join(', ')}`,
    );

    // Restore these files to their state at baseCommit (removes them from the
    // diff) and amend the current commit.
    for (const file of artifacts) {
      // Try to restore the file to its baseCommit version.  If the file didn't
      // exist at baseCommit, remove it from the index entirely.
      await this.git.raw(['checkout', baseCommit, '--', file]).catch(async () => {
        await this.git.raw(['rm', '--cached', '--force', '--', file]).catch(() => {});
      });
    }
    // Also clean artifacts from the working tree so they don't get re-staged.
    for (const pattern of ['.cadre/', 'task-*.md', ...this.syncedAgentFiles]) {
      await this.git.raw(['clean', '-fd', '--', pattern]).catch(() => {});
    }

    await this.git.raw(['commit', '--amend', '--no-edit']).catch(() => {
      // If nothing changed (e.g. all artifacts were already at base state), that's fine.
    });

    this.logger.info('Pre-push guard: cadre artifacts removed from diff');
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
