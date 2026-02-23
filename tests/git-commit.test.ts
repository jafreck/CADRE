import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitManager } from '../src/git/commit.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';

// Mock simple-git
const mockGit = {
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
  push: vi.fn().mockResolvedValue(undefined),
  diff: vi.fn().mockResolvedValue(''),
  status: vi.fn().mockResolvedValue({ isClean: () => true, staged: [], files: [] }),
  reset: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue(''),
  revparse: vi.fn().mockResolvedValue('abc123'),
  log: vi.fn().mockResolvedValue({ latest: { hash: 'abc123' } }),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
  default: vi.fn(() => mockGit),
}));

describe('CommitManager', () => {
  let manager: CommitManager;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit.status.mockResolvedValue({ isClean: () => true, staged: [], files: [] });
    mockGit.raw.mockResolvedValue('');

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const mockCommitConfig = {
      conventional: true,
      sign: false,
      commitPerPhase: true,
      squashBeforePR: false,
    } as CadreConfig['commits'];

    manager = new CommitManager('/tmp/worktree', mockCommitConfig, mockLogger);
  });

  it('should be constructable', () => {
    expect(manager).toBeDefined();
  });

  it('should have commit method', () => {
    expect(typeof manager.commit).toBe('function');
  });

  it('should have commitFiles method', () => {
    expect(typeof manager.commitFiles).toBe('function');
  });

  it('should have push method', () => {
    expect(typeof manager.push).toBe('function');
  });

  it('should have squash method', () => {
    expect(typeof manager.squash).toBe('function');
  });

  it('should have getChangedFiles method', () => {
    expect(typeof manager.getChangedFiles).toBe('function');
  });

  it('should have isClean method', () => {
    expect(typeof manager.isClean).toBe('function');
  });

  it('should have getDiff method', () => {
    expect(typeof manager.getDiff).toBe('function');
  });

  it('should have getTaskDiff method', () => {
    expect(typeof manager.getTaskDiff).toBe('function');
  });

  describe('getTaskDiff', () => {
    it('should return diff of last commit using HEAD~1..HEAD', async () => {
      const expectedDiff = 'diff --git a/src/foo.ts b/src/foo.ts\n+added line';
      mockGit.diff.mockResolvedValueOnce(expectedDiff);

      const result = await manager.getTaskDiff();

      expect(mockGit.diff).toHaveBeenCalledWith(['HEAD~1..HEAD']);
      expect(result).toBe(expectedDiff);
    });

    it('should fall back to git show HEAD when HEAD~1 does not exist', async () => {
      const showOutput = 'commit abc123\n+first file content';
      mockGit.diff.mockRejectedValueOnce(new Error('unknown revision HEAD~1'));
      mockGit.raw.mockResolvedValueOnce(showOutput);

      const result = await manager.getTaskDiff();

      expect(mockGit.diff).toHaveBeenCalledWith(['HEAD~1..HEAD']);
      expect(mockGit.raw).toHaveBeenCalledWith(['show', 'HEAD']);
      expect(result).toBe(showOutput);
    });

    it('should return empty string when diff is empty', async () => {
      mockGit.diff.mockResolvedValueOnce('');

      const result = await manager.getTaskDiff();

      expect(result).toBe('');
    });
  });

  describe('artifact filtering', () => {
    it('should call git restore --staged to unstage cadre artifacts after staging all', async () => {
      // Return staged files so commit proceeds
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await manager.commit('fix: something', 1, 'fix');

      // git.add('-A') must be called first
      expect(mockGit.add).toHaveBeenCalledWith(['-A']);

      // Then cadre artifacts must be unstaged
      const restoreCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'restore' &&
          args[0].includes('--staged') &&
          args[0].includes('.cadre/'),
      );
      expect(restoreCalls.length).toBeGreaterThan(0);
    });

    it('should not commit .cadre/ or task-*.md files', async () => {
      // Only cadre artifacts staged — after restore they'd be removed, status shows empty
      mockGit.status.mockResolvedValue({
        isClean: () => true,
        staged: [],
        files: [],
      });

      const sha = await manager.commit('chore: update', 1);
      expect(sha).toBe('');
      expect(mockGit.commit).not.toHaveBeenCalled();
    });
  });
});
