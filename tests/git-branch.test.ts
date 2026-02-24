import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BranchManager } from '../src/git/branch.js';
import { Logger } from '../src/logging/logger.js';

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    branch: vi.fn(),
    branchLocal: vi.fn(),
    checkout: vi.fn(),
    deleteLocalBranch: vi.fn(),
    push: vi.fn(),
    raw: vi.fn(),
    revparse: vi.fn(),
    listRemote: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

describe('BranchManager', () => {
  let manager: BranchManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    manager = new BranchManager('/tmp/repo', mockLogger);
  });

  it('should be constructable', () => {
    expect(manager).toBeDefined();
  });

  // Basic structural tests — full integration tests require a real git repo
  it('should have create method', () => {
    expect(typeof manager.create).toBe('function');
  });

  it('should have deleteLocal method', () => {
    expect(typeof manager.deleteLocal).toBe('function');
  });

  it('should have existsLocal method', () => {
    expect(typeof manager.existsLocal).toBe('function');
  });

  it('should have existsRemote method', () => {
    expect(typeof manager.existsRemote).toBe('function');
  });

  it('should have getHead method', () => {
    expect(typeof manager.getHead).toBe('function');
  });

  describe('create', () => {
    it('should call git.branch with branchName and baseRef', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await manager.create('cadre/issue-42', 'abc123');

      expect(mockGit.branch).toHaveBeenCalledWith(['cadre/issue-42', 'abc123']);
    });

    it('should log debug after creating branch', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await manager.create('cadre/issue-42', 'abc123');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Created branch cadre/issue-42'),
      );
    });
  });

  describe('deleteLocal', () => {
    it('should call git.branch with -D flag', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await manager.deleteLocal('cadre/issue-42');

      expect(mockGit.branch).toHaveBeenCalledWith(['-D', 'cadre/issue-42']);
    });

    it('should log warn and not throw when git.branch throws', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('branch not found'));

      await expect(manager.deleteLocal('cadre/issue-42')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete local branch'),
      );
    });
  });

  describe('deleteRemote', () => {
    it('should call git.push with origin --delete', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.push as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await manager.deleteRemote('cadre/issue-42');

      expect(mockGit.push).toHaveBeenCalledWith(['origin', '--delete', 'cadre/issue-42']);
    });

    it('should log warn and not throw when push throws', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('remote not found'));

      await expect(manager.deleteRemote('cadre/issue-42')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete remote branch'),
      );
    });
  });

  describe('existsLocal', () => {
    it('should return true when branch is in local branch list', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ all: ['main', 'cadre/issue-42'] });

      const result = await manager.existsLocal('cadre/issue-42');
      expect(result).toBe(true);
    });

    it('should return false when branch is not in local branch list', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ all: ['main'] });

      const result = await manager.existsLocal('cadre/issue-42');
      expect(result).toBe(false);
    });

    it('should return false when branchLocal throws', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('git error'));

      const result = await manager.existsLocal('cadre/issue-42');
      expect(result).toBe(false);
    });
  });

  describe('existsRemote', () => {
    it('should return true when ls-remote returns non-empty output', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42\n');

      const result = await manager.existsRemote('cadre/issue-42');
      expect(result).toBe(true);
    });

    it('should return false when ls-remote returns empty output', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

      const result = await manager.existsRemote('cadre/issue-42');
      expect(result).toBe(false);
    });

    it('should return false when raw throws', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.raw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));

      const result = await manager.existsRemote('cadre/issue-42');
      expect(result).toBe(false);
    });
  });

  describe('getHead', () => {
    it('should call revparse HEAD on the given worktree path and return trimmed SHA', async () => {
      const mockGit = (await import('simple-git')).simpleGit('/tmp/repo') as ReturnType<typeof import('simple-git').simpleGit>;
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValueOnce('deadbeef\n');

      const result = await manager.getHead('/tmp/worktree/issue-42');
      expect(result).toBe('deadbeef');
    });
  });
});
