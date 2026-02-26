import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import * as fsp from 'node:fs/promises';
import { WorktreeManager, RemoteBranchMissingError } from '../src/git/worktree.js';
import { DependencyMergeConflictError } from '../src/errors.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

// Mock node:fs/promises so we can assert dep-conflict.json writes without touching disk
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  readdir: vi.fn().mockResolvedValue([]),
}));

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn().mockResolvedValue(''),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    revparse: vi.fn().mockResolvedValue('abc123'),
    branch: vi.fn().mockResolvedValue(undefined),
    branchLocal: vi.fn().mockResolvedValue({ all: [] }),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

// Mock fs utilities
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readFileOrNull: vi.fn().mockResolvedValue(null),
  atomicWriteFile: vi.fn().mockResolvedValue(undefined),
}));

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    manager = new WorktreeManager(
      '/tmp/repo',
      '/tmp/worktrees',
      'main',
      'cadre/issue-{issue}',
      mockLogger,
    );
  });

  describe('resolveBranchName', () => {
    it('should replace {issue} placeholder', () => {
      const name = manager.resolveBranchName(42);
      expect(name).toBe('cadre/issue-42');
    });

    it('should replace {title} placeholder', () => {
      const mgr = new WorktreeManager(
        '/tmp/repo',
        '/tmp/worktrees',
        'main',
        'cadre/{issue}-{title}',
        mockLogger,
      );
      const name = mgr.resolveBranchName(42, 'Fix Login Timeout');
      expect(name).toBe('cadre/42-fix-login-timeout');
    });

    it('should sanitize special characters from title', () => {
      const mgr = new WorktreeManager(
        '/tmp/repo',
        '/tmp/worktrees',
        'main',
        'cadre/{issue}-{title}',
        mockLogger,
      );
      const name = mgr.resolveBranchName(42, 'Fix: weird @chars! (here)');
      expect(name).not.toMatch(/[@!()]/);
    });

    it('should truncate long branch names', () => {
      const mgr = new WorktreeManager(
        '/tmp/repo',
        '/tmp/worktrees',
        'main',
        'cadre/{issue}-{title}',
        mockLogger,
      );
      const longTitle = 'a'.repeat(200);
      const name = mgr.resolveBranchName(42, longTitle);
      expect(name.length).toBeLessThanOrEqual(100);
    });
  });

  it('should have provision method', () => {
    expect(typeof manager.provision).toBe('function');
  });

  it('should have remove method', () => {
    expect(typeof manager.remove).toBe('function');
  });

  it('should have listActive method', () => {
    expect(typeof manager.listActive).toBe('function');
  });

  it('should have exists method', () => {
    expect(typeof manager.exists).toBe('function');
  });

  it('should have rebase method', () => {
    expect(typeof manager.rebase).toBe('function');
  });

  describe('getWorktreePath', () => {
    it('should be a public method', () => {
      expect(typeof manager.getWorktreePath).toBe('function');
    });

    it('should return the correct path for an issue number', () => {
      const path = manager.getWorktreePath(42);
      expect(path).toBe('/tmp/worktrees/issue-42');
    });

    it('should include the issue number in the path', () => {
      expect(manager.getWorktreePath(100)).toContain('issue-100');
    });
  });

  describe('RemoteBranchMissingError', () => {
    it('should extend Error', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err).toBeInstanceOf(Error);
    });

    it('should have name RemoteBranchMissingError', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err.name).toBe('RemoteBranchMissingError');
    });

    it('should include branch name in message', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err.message).toContain('cadre/issue-42');
    });
  });

  describe('provision (fresh path)', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('basesha');
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    });

    it('should create a fresh worktree when resume is false and worktree does not exist', async () => {
      const result = await manager.provision(42, 'my issue');

      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('should call git worktree add with the correct path', async () => {
      await manager.provision(42, 'my issue');

      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'add', '/tmp/worktrees/issue-42']),
      );
    });

    it('should create branch from base commit when branch does not exist locally', async () => {
      await manager.provision(42, 'my issue');

      expect(mockGit.branch).toHaveBeenCalledWith(
        expect.arrayContaining(['cadre/issue-42', 'basesha']),
      );
    });

    it('should skip branch creation when branch already exists locally', async () => {
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/issue-42'] });

      await manager.provision(42, 'my issue');

      expect(mockGit.branch).not.toHaveBeenCalled();
    });

    it('should fall back to local base branch when origin/<base> revparse fails', async () => {
      (mockGit.revparse as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('unknown revision origin/main'))
        .mockResolvedValueOnce('localsha');

      const result = await manager.provision(42, 'my issue');

      expect(result.baseCommit).toBe('localsha');
    });

    it('should return syncedAgentFiles in the result', async () => {
      const result = await manager.provision(42, 'my issue');

      expect(Array.isArray(result.syncedAgentFiles)).toBe(true);
    });

    it('should log info after provisioning', async () => {
      await manager.provision(42, 'my issue');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Provisioned worktree for issue #42'),
        expect.any(Object),
      );
    });
  });

  describe('provision (resume path)', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      // Default: worktree does not exist
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      // Default: revparse returns a commit SHA
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
      // Default: ls-remote returns empty (branch absent)
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      // Default: no local branches
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
    });

    it('should return existing WorktreeInfo when worktree already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      const result = await manager.provision(42, 'my issue');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('should throw RemoteBranchMissingError when resume=true and remote branch is absent', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      await expect(manager.provision(42, 'my issue', true)).rejects.toThrow(RemoteBranchMissingError);
    });

    it('should fetch and create worktree when resume=true and remote branch exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42') // ls-remote
        .mockResolvedValue(''); // worktree add
      const result = await manager.provision(42, 'my issue', true);
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
    });
  });

  it('should have provisionFromBranch method', () => {
    expect(typeof manager.provisionFromBranch).toBe('function');
  });

  describe('provisionFromBranch', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
    });

    it('should return existing worktree info if directory already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(true);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('deadbeef\n');

      const result = await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(result.issueNumber).toBe(42);
      expect(result.branch).toBe('cadre/issue-42');
      expect(result.exists).toBe(true);
      expect(result.path).toContain('issue-42');
    });

    it('should not call git.fetch when worktree already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(true);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('deadbeef\n');

      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockGit.fetch).not.toHaveBeenCalled();
    });

    it('should fetch the remote branch when worktree does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('abc123\n');

      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
    });

    it('should add git worktree checked out to origin/<branch>', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('abc123\n');

      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'add']),
      );
      const rawCall = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: string[]) => c[0]?.includes?.('worktree') || (Array.isArray(c[0]) && c[0][0] === 'worktree'),
      );
      expect(rawCall).toBeDefined();
    });

    it('should return a WorktreeInfo with correct shape', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('abc123\n');

      const result = await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(result).toMatchObject({
        issueNumber: 42,
        branch: 'cadre/issue-42',
        exists: true,
      });
      expect(typeof result.path).toBe('string');
      expect(typeof result.baseCommit).toBe('string');
    });

    it('should log info after provisioning from branch', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('abc123\n');

      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Provisioned worktree from branch'),
        expect.anything(),
      );
    });
  });

  describe('prefetch', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      // simpleGit is mocked; calling it returns the shared mock instance
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
    });

    it('should expose a public prefetch method', () => {
      expect(typeof manager.prefetch).toBe('function');
    });

    it('should call git.fetch with origin and baseBranch', async () => {
      await manager.prefetch();
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });

    it('should log debug message on successful fetch', async () => {
      await manager.prefetch();
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetched origin/main');
    });

    it('should not throw when fetch fails', async () => {
      (mockGit.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
      await expect(manager.prefetch()).resolves.toBeUndefined();
    });

    it('should log warn when fetch fails', async () => {
      (mockGit.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
      await manager.prefetch();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch origin/main, continuing with local',
      );
    });
  });

  describe('provisionFromBranch', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      // Default: worktree does not exist
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      // revparse returns a HEAD commit for newly created worktree
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('def456\n');
    });

    it('should expose a public provisionFromBranch method', () => {
      expect(typeof manager.provisionFromBranch).toBe('function');
    });

    it('should fetch the remote branch before adding the worktree', async () => {
      await manager.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
    });

    it('should add the worktree checked out to the remote branch', async () => {
      await manager.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '-B',
        'cadre/issue-42',
        '/tmp/worktrees/issue-42',
        'origin/cadre/issue-42',
      ]);
    });

    it('should return a WorktreeInfo with correct fields', async () => {
      const result = await manager.provisionFromBranch(42, 'cadre/issue-42');
      expect(result).toMatchObject({
        issueNumber: 42,
        path: '/tmp/worktrees/issue-42',
        branch: 'cadre/issue-42',
        exists: true,
      });
      expect(result.baseCommit).toBeTruthy();
    });

    it('should return existing worktree info without re-provisioning when worktree exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);

      const result = await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockGit.fetch).not.toHaveBeenCalled();
      // raw IS called for merge-base (to find the fork point), but not for worktree add
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      expect(rawCalls.every((args: string[][]) => !args[0].includes('worktree'))).toBe(true);
      expect(result).toMatchObject({
        issueNumber: 42,
        path: '/tmp/worktrees/issue-42',
        branch: 'cadre/issue-42',
        exists: true,
      });
    });

    it('should log info when returning an existing worktree', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);

      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worktree already exists for issue #42',
        expect.objectContaining({ issueNumber: 42 }),
      );
    });

    it('should log info after successfully provisioning a new worktree', async () => {
      await manager.provisionFromBranch(42, 'cadre/issue-42');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Provisioned worktree from branch cadre/issue-42 for issue #42',
        expect.objectContaining({ issueNumber: 42 }),
      );
    });
  });

  describe('buildWorktreeInfo (via public provision methods)', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('basesha');
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    });

    it('should use the pre-computed baseCommit from revparse in the fresh provision path', async () => {
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('precomputed-sha');

      const result = await manager.provision(42, 'my issue');

      expect(result.baseCommit).toBe('precomputed-sha');
    });

    it('should fall back to getBaseCommit (merge-base) when no baseCommit is pre-computed (existing worktree)', async () => {
      // Existing worktree: buildWorktreeInfo called without a baseCommit
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'merge-base') return Promise.resolve('merge-base-sha\n');
        return Promise.resolve('');
      });

      const result = await manager.provision(42, 'my issue');

      expect(result.baseCommit).toBe('merge-base-sha');
    });

    it('should fall back to HEAD when merge-base calls both fail (new worktree, no common ancestor)', async () => {
      // Existing worktree: buildWorktreeInfo called without a baseCommit; merge-base returns empty
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'merge-base') return Promise.resolve('');
        return Promise.resolve('');
      });
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('head-sha');

      const result = await manager.provision(42, 'my issue');

      expect(result.baseCommit).toBe('head-sha');
    });

    it('should return syncedAgentFiles as an empty array when no agentDir is configured', async () => {
      const result = await manager.provision(42, 'my issue');

      expect(result.syncedAgentFiles).toEqual([]);
    });

    it('should populate syncedAgentFiles when agentDir contains .md source files', async () => {
      const managerWithAgentDir = new WorktreeManager(
        '/tmp/repo',
        '/tmp/worktrees',
        'main',
        'cadre/issue-{issue}',
        mockLogger,
        '/tmp/agents',
      );

      // agentDir exists and contains an agent file
      vi.mocked(fsUtils.exists).mockImplementation(async (p: string) => {
        // worktree path does not exist (fresh provision)
        if (p === '/tmp/worktrees/issue-42') return false;
        // agentDir exists
        if (p === '/tmp/agents') return true;
        return false;
      });
      vi.mocked(fsp.readdir).mockResolvedValue(['code-writer.md'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>);
      vi.mocked(fsp.readFile).mockResolvedValue('agent body content' as unknown as Buffer);

      const result = await managerWithAgentDir.provision(42, 'my issue');

      expect(result.syncedAgentFiles.length).toBeGreaterThan(0);
      expect(result.syncedAgentFiles[0]).toContain('code-writer');
    });

    it('should include all three provision methods consistently returning syncedAgentFiles array', async () => {
      // provision
      const r1 = await manager.provision(42, 'my issue');
      expect(Array.isArray(r1.syncedAgentFiles)).toBe(true);

      // provisionFromBranch (existing)
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      const r2 = await manager.provisionFromBranch(42, 'cadre/issue-42');
      expect(Array.isArray(r2.syncedAgentFiles)).toBe(true);
    });
  });

  describe('provisionWithDeps', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    const makeDep = (number: number, title: string) => ({
      number,
      title,
      body: '',
      labels: [],
      assignees: [],
      comments: [],
      state: 'open' as const,
      createdAt: '',
      updatedAt: '',
      linkedPRs: [],
    });

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('basesha');
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    });

    it('should have provisionWithDeps method', () => {
      expect(typeof manager.provisionWithDeps).toBe('function');
    });

    it('should create deps branch from baseBranch', async () => {
      await manager.provisionWithDeps(42, 'my issue', []);

      expect(mockGit.branch).toHaveBeenCalledWith(
        expect.arrayContaining(['cadre/deps-42']),
      );
    });

    it('should add a temporary worktree for the deps branch', async () => {
      await manager.provisionWithDeps(42, 'my issue', []);

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const depsWorktreeAdd = rawCalls.find(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'worktree' &&
          args[0][1] === 'add' &&
          (args[0][2] as string)?.includes('deps-42'),
      );
      expect(depsWorktreeAdd).toBeDefined();
    });

    it('should create the issue branch from the deps branch HEAD', async () => {
      await manager.provisionWithDeps(42, 'my issue', []);

      expect(mockGit.branch).toHaveBeenCalledWith(
        expect.arrayContaining(['cadre/issue-42']),
      );
    });

    it('should add a worktree for the issue branch (not the deps branch)', async () => {
      await manager.provisionWithDeps(42, 'my issue', []);

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const issueWorktreeAdd = rawCalls.find(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'worktree' &&
          args[0][1] === 'add' &&
          args[0][2] === '/tmp/worktrees/issue-42',
      );
      expect(issueWorktreeAdd).toBeDefined();
    });

    it('should return WorktreeInfo with issue branch name (not deps branch)', async () => {
      const result = await manager.provisionWithDeps(42, 'my issue', []);

      expect(result.branch).toBe('cadre/issue-42');
      expect(result.branch).not.toContain('deps');
    });

    it('should return WorktreeInfo with correct issueNumber and path', async () => {
      const result = await manager.provisionWithDeps(42, 'my issue', []);

      expect(result.issueNumber).toBe(42);
      expect(result.path).toBe('/tmp/worktrees/issue-42');
      expect(result.exists).toBe(true);
    });

    it('should remove the temp deps worktree after successful merges', async () => {
      await manager.provisionWithDeps(42, 'my issue', []);

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const worktreeRemove = rawCalls.find(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'worktree' &&
          args[0][1] === 'remove' &&
          (args[0][2] as string)?.includes('deps-42'),
      );
      expect(worktreeRemove).toBeDefined();
    });

    it('should return existing worktree info if directory already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);

      const result = await manager.provisionWithDeps(42, 'my issue', []);

      expect(result.issueNumber).toBe(42);
      expect(result.branch).toBe('cadre/issue-42');
      expect(mockGit.branch).not.toHaveBeenCalled();
    });

    it('should throw DependencyMergeConflictError on merge conflict', async () => {
      // simpleGit mock returns the same instance for all calls (including depsWorktreePath)
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        return Promise.resolve('');
      });

      const dep = makeDep(10, 'dep issue');
      await expect(manager.provisionWithDeps(42, 'my issue', [dep])).rejects.toThrow(
        DependencyMergeConflictError,
      );
    });

    it('should include issueNumber and conflictingBranch in DependencyMergeConflictError', async () => {
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        return Promise.resolve('');
      });

      const dep = makeDep(10, 'dep issue');
      let thrown: DependencyMergeConflictError | undefined;
      try {
        await manager.provisionWithDeps(42, 'my issue', [dep]);
      } catch (e) {
        thrown = e as DependencyMergeConflictError;
      }

      expect(thrown).toBeDefined();
      expect(thrown!.issueNumber).toBe(42);
      expect(thrown!.conflictingBranch).toContain('issue-10');
    });

    it('should write dep-conflict.json with required fields on merge conflict', async () => {
      const mockWriteFile = vi.mocked(fsp.writeFile);
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\nsrc/bar.ts\n');
        return Promise.resolve('');
      });

      const dep = makeDep(10, 'dep issue');
      await expect(manager.provisionWithDeps(42, 'my issue', [dep])).rejects.toThrow(
        DependencyMergeConflictError,
      );

      const writeFileCalls = mockWriteFile.mock.calls;
      const conflictWrite = writeFileCalls.find((args) =>
        String(args[0]).endsWith('dep-conflict.json'),
      );
      expect(conflictWrite).toBeDefined();

      const writtenContent = JSON.parse(conflictWrite![1] as string);
      expect(writtenContent.issueNumber).toBe(42);
      expect(writtenContent.conflictingBranch).toContain('issue-10');
      expect(Array.isArray(writtenContent.conflictedFiles)).toBe(true);
      expect(writtenContent.conflictedFiles).toContain('src/foo.ts');
      expect(typeof writtenContent.timestamp).toBe('string');
      // Timestamp should be a valid ISO 8601 string
      expect(() => new Date(writtenContent.timestamp).toISOString()).not.toThrow();
    });

    it('should merge each dep branch in the order provided', async () => {
      const mergeFn = vi.fn().mockResolvedValue(undefined);
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = mergeFn;

      const deps = [makeDep(10, 'first dep'), makeDep(20, 'second dep'), makeDep(30, 'third dep')];
      await manager.provisionWithDeps(42, 'my issue', deps);

      expect(mergeFn).toHaveBeenCalledTimes(3);
      const mergeArgs = mergeFn.mock.calls.map((c: string[][]) => c[0][0]);
      expect(mergeArgs[0]).toContain('issue-10');
      expect(mergeArgs[1]).toContain('issue-20');
      expect(mergeArgs[2]).toContain('issue-30');
    });

    it('should remove the temp deps worktree even when a merge conflict occurs', async () => {
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        return Promise.resolve('');
      });

      const dep = makeDep(10, 'dep issue');
      await expect(manager.provisionWithDeps(42, 'my issue', [dep])).rejects.toThrow(
        DependencyMergeConflictError,
      );

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const worktreeRemove = rawCalls.find(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'worktree' &&
          args[0][1] === 'remove' &&
          (args[0][2] as string)?.includes('deps-42'),
      );
      expect(worktreeRemove).toBeDefined();
    });
  });
});
