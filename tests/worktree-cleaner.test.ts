import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import { WorktreeCleaner } from '../src/git/worktree-cleaner.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

const mockGitRaw = vi.fn().mockResolvedValue('');

vi.mock('simple-git', () => {
  const mockGit = {
    raw: mockGitRaw,
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(true),
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

describe('WorktreeCleaner', () => {
  let mockLogger: Logger;
  let mockGit: { raw: ReturnType<typeof vi.fn> };
  let cleaner: WorktreeCleaner;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    mockGit = { raw: mockGitRaw };
    cleaner = new WorktreeCleaner(mockGit as any, '/tmp/worktrees', mockLogger);
  });

  describe('getWorktreePath', () => {
    it('returns the expected path', () => {
      expect(cleaner.getWorktreePath(42)).toBe('/tmp/worktrees/issue-42');
    });
  });

  describe('remove', () => {
    it('removes an existing worktree with --force', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(true);
      await cleaner.remove(42);

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'remove',
        '/tmp/worktrees/issue-42',
        '--force',
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Removed worktree for issue #42'),
        expect.any(Object),
      );
    });

    it('is a no-op when the worktree path does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      await cleaner.remove(99);

      expect(mockGit.raw).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already removed'),
        expect.any(Object),
      );
    });

    it('re-throws when git worktree remove fails', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(true);
      mockGit.raw.mockRejectedValueOnce(new Error('git error'));

      await expect(cleaner.remove(1)).rejects.toThrow('git error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('removeWorktreeAtPath', () => {
    it('removes the directory with fs.rm', async () => {
      await cleaner.removeWorktreeAtPath('/tmp/some-dir');

      expect(fsp.rm).toHaveBeenCalledWith('/tmp/some-dir', { recursive: true, force: true });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/some-dir'),
      );
    });

    it('is non-fatal on failure — logs a warning instead of throwing', async () => {
      vi.mocked(fsp.rm as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(cleaner.removeWorktreeAtPath('/tmp/gone')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/gone'),
      );
    });
  });
});
