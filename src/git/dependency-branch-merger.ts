import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Logger } from '../logging/logger.js';
import { ensureDir } from '../util/fs.js';
import { DependencyMergeConflictError } from '../errors.js';
import type { IssueDetail } from '../platform/provider.js';

/**
 * Handles creating the deps branch and merging dependency branches into it.
 */
export class DependencyBranchMerger {
  constructor(
    private readonly git: SimpleGit,
    private readonly repoPath: string,
    private readonly logger: Logger,
    private readonly resolveBranchName: (issueNumber: number, title: string) => string,
  ) {}

  /**
   * Creates the `cadre/deps-{issueNumber}` branch from `baseCommit` (if not
   * already present), merges each dep branch in order into a temporary
   * worktree, and returns the HEAD SHA of the merged deps branch.
   *
   * Throws `DependencyMergeConflictError` (and writes `.cadre/dep-conflict.json`
   * into the main repo) when a merge conflict occurs.
   *
   * The temporary deps worktree is always removed — even on failure — and the
   * deps branch is deleted on failure so retries can recreate it cleanly.
   */
  async mergeDependencies(
    issueNumber: number,
    deps: IssueDetail[],
    baseCommit: string,
    worktreeRoot: string,
  ): Promise<string> {
    const depsBranch = `cadre/deps-${issueNumber}`;

    // Create deps branch from base commit if it does not already exist
    const depsBranchExists = await this.branchExistsLocal(depsBranch);
    if (!depsBranchExists) {
      await this.git.branch([depsBranch, baseCommit.trim()]);
    }

    // Create a temporary worktree to perform merges on the deps branch
    const depsWorktreePath = join(worktreeRoot, `deps-${issueNumber}`);
    await ensureDir(worktreeRoot);
    await this.git.raw(['worktree', 'add', depsWorktreePath, depsBranch]);
    const depsGit = simpleGit(depsWorktreePath);

    let mergeSucceeded = false;
    try {
      for (const dep of deps) {
        const depBranch = this.resolveBranchName(dep.number, dep.title);
        try {
          await depsGit.merge([depBranch, '--no-edit']);
        } catch {
          const conflictedFiles = await this.getConflictedFiles(depsWorktreePath);

          const cadreDir = join(this.repoPath, '.cadre');
          await ensureDir(cadreDir);
          await writeFile(
            join(cadreDir, 'dep-conflict.json'),
            JSON.stringify(
              { issueNumber, conflictingBranch: depBranch, conflictedFiles, timestamp: new Date().toISOString() },
              null,
              2,
            ),
            'utf-8',
          );

          await depsGit.raw(['merge', '--abort']).catch(() => {});
          throw new DependencyMergeConflictError(
            `Merge conflict when merging '${depBranch}' into '${depsBranch}' for issue #${issueNumber}`,
            issueNumber,
            depBranch,
          );
        }
      }
      mergeSucceeded = true;
    } finally {
      // Always clean up the temporary deps worktree
      await this.git.raw(['worktree', 'remove', depsWorktreePath, '--force']).catch(() => {});
      // On failure, delete the deps branch so retries can recreate it cleanly
      if (!mergeSucceeded) {
        await this.git.branch(['-D', depsBranch]).catch(() => {});
      }
    }

    const depsHead = await this.git.revparse([depsBranch]);
    return depsHead.trim();
  }

  private async getConflictedFiles(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      const output = await worktreeGit.raw(['diff', '--name-only', '--diff-filter=U']);
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private async branchExistsLocal(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch {
      return false;
    }
  }
}
