import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import { WorktreeManager, RemoteBranchMissingError } from '../src/git/worktree.js';
import { Logger } from '../src/logging/logger.js';

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

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readFileOrNull: vi.fn().mockResolvedValue(null),
  atomicWriteFile: vi.fn().mockResolvedValue(undefined),
}));

import { exists, ensureDir } from '../src/util/fs.js';

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

  describe('provision', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      // Default: worktree does not exist
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      // Default: revparse returns a commit SHA
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
      // Default: ls-remote returns empty (branch absent)
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      // Default: no local branches
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
    });

    it('should return existing WorktreeInfo when worktree already exists', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      const result = await manager.provision(42, 'my issue');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('should return existing WorktreeInfo when worktree exists and resume=false', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      const result = await manager.provision(42, 'my issue', false);
      expect(result.exists).toBe(true);
      expect(result.issueNumber).toBe(42);
    });

    it('should return existing WorktreeInfo when worktree exists and resume=true', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      const result = await manager.provision(42, 'my issue', true);
      expect(result.exists).toBe(true);
      expect(result.issueNumber).toBe(42);
    });

    it('should throw RemoteBranchMissingError when resume=true and remote branch is absent', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      await expect(manager.provision(42, 'my issue', true)).rejects.toThrow(RemoteBranchMissingError);
    });

    it('should throw RemoteBranchMissingError with correct branch name', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('   ');
      await expect(manager.provision(42, 'my issue', true)).rejects.toThrow(
        /cadre\/issue-42/,
      );
    });

    it('should fetch and create worktree when resume=true and remote branch exists', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42') // ls-remote
        .mockResolvedValue(''); // worktree add
      const result = await manager.provision(42, 'my issue', true);
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('should log info after successful resume', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42')
        .mockResolvedValue('');
      await manager.provision(42, 'my issue', true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Resumed worktree'),
        expect.anything(),
      );
    });

    it('should create a new branch and worktree on fresh provision (no resume)', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('deadbeef\n');
      const result = await manager.provision(42, 'my issue');
      expect(mockGit.branch).toHaveBeenCalledWith(['cadre/issue-42', 'deadbeef']);
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
    });

    it('should skip branch creation on fresh provision when local branch already exists', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/issue-42'] });
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('deadbeef\n');
      await manager.provision(42, 'my issue');
      expect(mockGit.branch).not.toHaveBeenCalled();
    });

    it('should log info after successful fresh provision', async () => {
      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123\n');
      await manager.provision(42, 'my issue');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Provisioned worktree'),
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

  describe('RemoteBranchMissingError', () => {
    it('should be an instance of Error', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err).toBeInstanceOf(Error);
    });

    it('should have the correct name', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err.name).toBe('RemoteBranchMissingError');
    });

    it('should include the branch name in the message', () => {
      const err = new RemoteBranchMissingError('cadre/issue-42');
      expect(err.message).toContain('cadre/issue-42');
    });
  });

  describe('provision with resume=true', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      // Default: worktree does not exist on disk
      vi.mocked(exists).mockResolvedValue(false);
      vi.mocked(ensureDir).mockResolvedValue(undefined);
    });

    it('should return WorktreeInfo when worktree is absent but remote branch exists', async () => {
      // ls-remote returns a non-empty string → branch exists on origin
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42') // ls-remote
        .mockResolvedValueOnce(''); // worktree add

      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');

      const result = await manager.provision(42, 'Fix bug', true);

      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.path).toContain('issue-42');
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('should call git.fetch with the branch when remote branch exists', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42')
        .mockResolvedValueOnce('');

      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');

      await manager.provision(42, 'Fix bug', true);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
    });

    it('should call git worktree add when remote branch exists', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42')
        .mockResolvedValueOnce('');

      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');

      await manager.provision(42, 'Fix bug', true);

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const worktreeAddCall = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0].includes('worktree') && args[0].includes('add'),
      );
      expect(worktreeAddCall).toBeDefined();
    });

    it('should throw RemoteBranchMissingError when both worktree and remote branch are absent', async () => {
      // ls-remote returns empty string → branch does not exist on origin
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

      await expect(manager.provision(42, 'Fix bug', true)).rejects.toThrow(
        RemoteBranchMissingError,
      );
    });

    it('should include the branch name in RemoteBranchMissingError message', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

      await expect(manager.provision(42, 'Fix bug', true)).rejects.toThrow(
        'cadre/issue-42',
      );
    });
  });

  describe('provision without resume flag (fresh provisioning)', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(exists).mockResolvedValue(false);
      vi.mocked(ensureDir).mockResolvedValue(undefined);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    });

    it('should return a valid WorktreeInfo for fresh provisioning', async () => {
      const result = await manager.provision(99, 'New feature');
      expect(result.issueNumber).toBe(99);
      expect(result.exists).toBe(true);
      expect(result.path).toContain('issue-99');
    });

    it('should not call ls-remote when resume is not set', async () => {
      await manager.provision(99, 'New feature');
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const lsRemoteCall = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0].includes('ls-remote'),
      );
      expect(lsRemoteCall).toBeUndefined();
    });

    it('should not call ls-remote when resume is false', async () => {
      await manager.provision(99, 'New feature', false);
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const lsRemoteCall = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0].includes('ls-remote'),
      );
      expect(lsRemoteCall).toBeUndefined();
    });
  });

  describe('provision when worktree already exists', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      // Worktree already on disk
      vi.mocked(exists).mockResolvedValue(true);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
    });

    it('should return WorktreeInfo without creating a new worktree', async () => {
      const result = await manager.provision(42, 'Fix bug');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
    });

    it('should not call ls-remote when worktree already exists and resume=false', async () => {
      await manager.provision(42, 'Fix bug', false);
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const lsRemoteCall = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0].includes('ls-remote'),
      );
      expect(lsRemoteCall).toBeUndefined();
    });

    it('should not call ls-remote when worktree already exists and resume=true', async () => {
      await manager.provision(42, 'Fix bug', true);
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const lsRemoteCall = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0].includes('ls-remote'),
      );
      expect(lsRemoteCall).toBeUndefined();
    });
  });
});
