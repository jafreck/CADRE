import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import { WorktreeManager } from '../src/git/worktree.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

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
});
