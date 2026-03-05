import type { WorktreeInfo } from '../../src/git/worktree.js';

/**
 * Create a mock WorktreeInfo with sensible defaults.
 * All fields satisfy the WorktreeInfo interface without `as unknown` casts.
 */
export function makeMockWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    issueNumber: 42,
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    exists: true,
    baseCommit: 'abc123',
    syncedAgentFiles: [],
    ...overrides,
  };
}
