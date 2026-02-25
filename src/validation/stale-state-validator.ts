import { join } from 'node:path';
import type { SimpleGit } from 'simple-git';
import type { RuntimeConfig } from '../config/loader.js';
import type { PlatformProvider } from '../platform/provider.js';
import { exists } from '../util/fs.js';

export type StaleConflictKind = 'worktree' | 'remote-branch' | 'open-pr' | 'checkpoint-dir';

export interface StaleConflict {
  kind: StaleConflictKind;
  description: string;
}

export interface StaleStateResult {
  hasConflicts: boolean;
  conflicts: Map<number, StaleConflict[]>;
}

/**
 * Build a branch name from the template, substituting the issue number and optional title.
 * Mirrors the sanitisation and truncation logic in WorktreeManager.resolveBranchName().
 */
function buildBranchName(template: string, issueNumber: number, issueTitle?: string): string {
  let branch = template
    .replace('{issue}', String(issueNumber))
    .replace('{title}', issueTitle ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9/\-_]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-$/, '')
    .replace(/^-/, '');

  if (branch.length > 100) {
    branch = branch.slice(0, 100).replace(/-$/, '');
  }

  return branch;
}

/**
 * Check for pre-existing state that would conflict with a fresh CADRE run.
 *
 * Runs all four checks for every issue regardless of earlier failures
 * (collect-all behaviour) and returns a structured result.
 */
export async function checkStaleState(
  issueNumbers: number[],
  config: RuntimeConfig,
  provider: PlatformProvider,
  git: SimpleGit,
): Promise<StaleStateResult> {
  const conflicts = new Map<number, StaleConflict[]>();

  for (const issueNumber of issueNumbers) {
    const issueConflicts: StaleConflict[] = [];

    // Fetch the issue title when the template references {title} so the
    // branch name matches what WorktreeManager.resolveBranchName() produces.
    let issueTitle: string | undefined;
    if (config.branchTemplate.includes('{title}')) {
      try {
        const issue = await provider.getIssue(issueNumber);
        issueTitle = issue.title;
      } catch {
        // Fail open — provider errors should not block the run
      }
    }

    const branchName = buildBranchName(config.branchTemplate, issueNumber, issueTitle);

    // 1. Local worktree check
    const worktreePath = join(config.worktreeRoot, `issue-${issueNumber}`);
    if (await exists(worktreePath)) {
      issueConflicts.push({
        kind: 'worktree',
        description: `Local worktree already exists at ${worktreePath}`,
      });
    }

    // 2. Remote branch check via git ls-remote (no local fetch required)
    const remoteRef = `refs/heads/${branchName}`;
    try {
      const lsRemoteOutput = await git.raw(['ls-remote', 'origin', remoteRef]);
      if (lsRemoteOutput.trim()) {
        issueConflicts.push({
          kind: 'remote-branch',
          description: `Remote branch '${branchName}' already exists on origin`,
        });
      }
    } catch {
      // Fail open — network errors should not block the run
    }

    // 3. Open PR check via platform provider
    try {
      const prs = await provider.listPullRequests({ head: branchName, state: 'open' });
      if (prs.length > 0) {
        issueConflicts.push({
          kind: 'open-pr',
          description: `Open pull request already exists for branch '${branchName}' (PR #${prs[0].number})`,
        });
      }
    } catch {
      // Fail open — provider errors should not block the run
    }

    // 4. Checkpoint directory check
    const checkpointDir = join(config.stateDir, 'issues', String(issueNumber));
    if (await exists(checkpointDir)) {
      issueConflicts.push({
        kind: 'checkpoint-dir',
        description: `Checkpoint directory already exists at ${checkpointDir}`,
      });
    }

    if (issueConflicts.length > 0) {
      conflicts.set(issueNumber, issueConflicts);
    }
  }

  return {
    hasConflicts: conflicts.size > 0,
    conflicts,
  };
}

/**
 * TODO: Implement interactive resolution — allow the user to choose per-issue:
 *   - Resume: continue from existing state
 *   - Clean up: delete stale state and start fresh
 *   - Abort: skip this issue
 */
export async function resolveStaleState(
  _result: StaleStateResult,
  _config: RuntimeConfig,
): Promise<void> {
  throw new Error('Interactive stale-state resolution is not yet implemented');
}
