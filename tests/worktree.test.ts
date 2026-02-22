import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../src/git/worktree.js';
import { Logger } from '../src/logging/logger.js';

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn().mockResolvedValue(''),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    revparse: vi.fn().mockResolvedValue('abc123'),
    branch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

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
});
