/**
 * Tests that WorktreeManager is a pure thin facade — every public method
 * delegates directly to an internal WorktreeProvisioner instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../src/git/worktree.js';
import { WorktreeProvisioner } from '../src/git/worktree-provisioner.js';
import { Logger } from '../src/logging/logger.js';

// Mock the provisioner module so we can spy on its prototype methods without
// needing real git or file-system access.
vi.mock('../src/git/worktree-provisioner.js', () => {
  const MockProvisioner = vi.fn().mockImplementation(() => ({
    provision: vi.fn().mockResolvedValue({ issueNumber: 1, path: '/p', branch: 'b', exists: true, baseCommit: 'abc', syncedAgentFiles: [] }),
    provisionWithDeps: vi.fn().mockResolvedValue({ issueNumber: 1, path: '/p', branch: 'b', exists: true, baseCommit: 'abc', syncedAgentFiles: [] }),
    provisionFromBranch: vi.fn().mockResolvedValue({ issueNumber: 1, path: '/p', branch: 'b', exists: true, baseCommit: 'abc', syncedAgentFiles: [] }),
    provisionForDependencyAnalyst: vi.fn().mockResolvedValue('/tmp/dag-dir'),
    prefetch: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeWorktreeAtPath: vi.fn().mockResolvedValue(undefined),
    listActive: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(false),
    rebase: vi.fn().mockResolvedValue({ success: true }),
    rebaseStart: vi.fn().mockResolvedValue({ status: 'clean' }),
    rebaseContinue: vi.fn().mockResolvedValue({ success: true }),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
    resolveBranchName: vi.fn().mockReturnValue('cadre/issue-42'),
    getWorktreePath: vi.fn().mockReturnValue('/tmp/worktrees/issue-42'),
  }));
  return { WorktreeProvisioner: MockProvisioner, RemoteBranchMissingError: class RemoteBranchMissingError extends Error {} };
});

describe('WorktreeManager — thin facade delegation', () => {
  let manager: WorktreeManager;
  let mockLogger: Logger;
  let mockProvisioner: InstanceType<typeof WorktreeProvisioner>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    manager = new WorktreeManager('/repo', '/worktrees', 'main', 'cadre/issue-{issue}', mockLogger);

    // Retrieve the mocked instance that was created inside the WorktreeManager constructor
    mockProvisioner = vi.mocked(WorktreeProvisioner).mock.results[0].value as InstanceType<typeof WorktreeProvisioner>;
  });

  it('should instantiate WorktreeProvisioner with constructor arguments', () => {
    expect(WorktreeProvisioner).toHaveBeenCalledWith(
      '/repo',
      '/worktrees',
      'main',
      'cadre/issue-{issue}',
      mockLogger,
      undefined,
      'copilot',
    );
  });

  it('should delegate provision() to provisioner.provision()', async () => {
    await manager.provision(42, 'title', true);
    expect(mockProvisioner.provision).toHaveBeenCalledWith(42, 'title', true);
  });

  it('should delegate provisionWithDeps() to provisioner.provisionWithDeps()', async () => {
    const deps: never[] = [];
    await manager.provisionWithDeps(42, 'title', deps, true);
    expect(mockProvisioner.provisionWithDeps).toHaveBeenCalledWith(42, 'title', deps, true);
  });

  it('should delegate provisionFromBranch() to provisioner.provisionFromBranch()', async () => {
    await manager.provisionFromBranch(42, 'cadre/issue-42');
    expect(mockProvisioner.provisionFromBranch).toHaveBeenCalledWith(42, 'cadre/issue-42');
  });

  it('should delegate provisionForDependencyAnalyst() to provisioner.provisionForDependencyAnalyst()', async () => {
    const result = await manager.provisionForDependencyAnalyst('run-001');
    expect(mockProvisioner.provisionForDependencyAnalyst).toHaveBeenCalledWith('run-001');
    expect(result).toBe('/tmp/dag-dir');
  });

  it('should delegate prefetch() to provisioner.prefetch()', async () => {
    await manager.prefetch();
    expect(mockProvisioner.prefetch).toHaveBeenCalled();
  });

  it('should delegate remove() to provisioner.remove()', async () => {
    await manager.remove(42);
    expect(mockProvisioner.remove).toHaveBeenCalledWith(42);
  });

  it('should delegate removeWorktreeAtPath() to provisioner.removeWorktreeAtPath()', async () => {
    await manager.removeWorktreeAtPath('/some/path');
    expect(mockProvisioner.removeWorktreeAtPath).toHaveBeenCalledWith('/some/path');
  });

  it('should delegate listActive() to provisioner.listActive()', async () => {
    const result = await manager.listActive();
    expect(mockProvisioner.listActive).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('should delegate exists() to provisioner.exists()', async () => {
    const result = await manager.exists(42);
    expect(mockProvisioner.exists).toHaveBeenCalledWith(42);
    expect(result).toBe(false);
  });

  it('should delegate rebase() to provisioner.rebase()', async () => {
    const result = await manager.rebase(42);
    expect(mockProvisioner.rebase).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true });
  });

  it('should delegate rebaseStart() to provisioner.rebaseStart()', async () => {
    const result = await manager.rebaseStart(42);
    expect(mockProvisioner.rebaseStart).toHaveBeenCalledWith(42);
    expect(result).toEqual({ status: 'clean' });
  });

  it('should delegate rebaseContinue() to provisioner.rebaseContinue()', async () => {
    const result = await manager.rebaseContinue(42);
    expect(mockProvisioner.rebaseContinue).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true });
  });

  it('should delegate rebaseAbort() to provisioner.rebaseAbort()', async () => {
    await manager.rebaseAbort(42);
    expect(mockProvisioner.rebaseAbort).toHaveBeenCalledWith(42);
  });

  it('should delegate resolveBranchName() to provisioner.resolveBranchName()', () => {
    const result = manager.resolveBranchName(42, 'my issue');
    expect(mockProvisioner.resolveBranchName).toHaveBeenCalledWith(42, 'my issue');
    expect(result).toBe('cadre/issue-42');
  });

  it('should delegate getWorktreePath() to provisioner.getWorktreePath()', () => {
    const result = manager.getWorktreePath(42);
    expect(mockProvisioner.getWorktreePath).toHaveBeenCalledWith(42);
    expect(result).toBe('/tmp/worktrees/issue-42');
  });

  it('should forward the return value of provision() unchanged', async () => {
    const expected = { issueNumber: 42, path: '/p', branch: 'b', exists: true, baseCommit: 'abc', syncedAgentFiles: ['file.md'] };
    vi.mocked(mockProvisioner.provision).mockResolvedValueOnce(expected);
    const result = await manager.provision(42, 'title');
    expect(result).toEqual(expected);
  });

  it('should forward the return value of listActive() unchanged', async () => {
    const worktrees = [{ issueNumber: 7, path: '/p/issue-7', branch: 'b', exists: true, baseCommit: 'sha', syncedAgentFiles: [] }];
    vi.mocked(mockProvisioner.listActive).mockResolvedValueOnce(worktrees);
    const result = await manager.listActive();
    expect(result).toEqual(worktrees);
  });
});
