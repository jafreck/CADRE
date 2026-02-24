import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import { WorktreeManager } from '../src/git/worktree.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

// ── Mock simple-git ──────────────────────────────────────────────────────────
const mockEnvGit = { rebase: vi.fn().mockResolvedValue(undefined) };

const mockGit = {
  raw: vi.fn().mockResolvedValue(''),
  fetch: vi.fn().mockResolvedValue(undefined),
  revparse: vi.fn().mockResolvedValue('abc123'),
  branch: vi.fn().mockResolvedValue(undefined),
  branchLocal: vi.fn().mockResolvedValue({ all: [] }),
  rebase: vi.fn().mockResolvedValue(undefined),
  env: vi.fn().mockReturnValue(mockEnvGit),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
  default: vi.fn(() => mockGit),
}));

// ── Mock fs utilities ────────────────────────────────────────────────────────
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readFileOrNull: vi.fn().mockResolvedValue(null),
  atomicWriteFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeManager(logger: Logger) {
  return new WorktreeManager('/tmp/repo', '/tmp/worktrees', 'main', 'cadre/issue-{issue}', logger);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorktreeManager — rebase methods', () => {
  let manager: WorktreeManager;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: worktree path does not exist, no rebase-merge / rebase-apply dirs
    vi.mocked(fsUtils.exists).mockResolvedValue(false);
    // Default: rev-parse returns an absolute git-dir so join logic is simple
    mockGit.raw.mockResolvedValue('/tmp/repo/.git');
    mockGit.rebase.mockResolvedValue(undefined);
    mockEnvGit.rebase.mockResolvedValue(undefined);
    logger = makeLogger();
    manager = makeManager(logger);
  });

  // ── rebaseStart ──────────────────────────────────────────────────────────

  describe('rebaseStart', () => {
    it('returns clean when rebase succeeds', async () => {
      // raw: rev-parse --git-dir; diff (if called) => ''
      mockGit.raw.mockImplementation((args: string[]) => {
        if (args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        return Promise.resolve('');
      });
      // No rebase-merge / rebase-apply dirs
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      const result = await manager.rebaseStart(42);

      expect(result).toEqual({ status: 'clean' });
    });

    it('fetches origin/<baseBranch> before rebasing', async () => {
      mockGit.raw.mockResolvedValue('/tmp/repo/.git');
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      await manager.rebaseStart(42);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });

    it('logs info on a clean rebase', async () => {
      mockGit.raw.mockResolvedValue('/tmp/repo/.git');
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      await manager.rebaseStart(42);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rebased worktree cleanly for issue #42'),
        expect.any(Object),
      );
    });

    it('returns conflict with conflicted files when rebase throws', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        // diff --name-only --diff-filter=U
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/foo.ts\nsrc/bar.ts\n');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.rebase.mockRejectedValue(new Error('CONFLICT'));

      const result = await manager.rebaseStart(42);

      expect(result).toMatchObject({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts', 'src/bar.ts'],
      });
      expect((result as { worktreePath: string }).worktreePath).toContain('issue-42');
    });

    it('logs info listing conflicted files when rebase pauses', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/conflict.ts\n');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.rebase.mockRejectedValue(new Error('CONFLICT'));

      await manager.rebaseStart(42);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rebase paused for issue #42'),
        expect.any(Object),
      );
    });

    it('detects an already-paused rebase and skips fetch', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });
      // Simulate rebase-merge dir existing
      vi.mocked(fsUtils.exists).mockImplementation(async (p: string) => {
        return typeof p === 'string' && p.includes('rebase-merge');
      });

      const result = await manager.rebaseStart(42);

      expect(result).toMatchObject({ status: 'conflict' });
      expect(mockGit.fetch).not.toHaveBeenCalled();
    });

    it('logs warn when already-paused rebase is detected', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockImplementation(async (p: string) => {
        return typeof p === 'string' && p.includes('rebase-merge');
      });

      await manager.rebaseStart(42);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('rebase is already paused'),
        expect.any(Object),
      );
    });
  });

  // ── rebase ───────────────────────────────────────────────────────────────

  describe('rebase', () => {
    it('returns success:true when rebaseStart returns clean', async () => {
      mockGit.raw.mockResolvedValue('/tmp/repo/.git');
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      const result = await manager.rebase(42);

      expect(result).toEqual({ success: true });
    });

    it('aborts and returns success:false with conflicts on conflict', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/file.ts\n');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.rebase
        .mockRejectedValueOnce(new Error('CONFLICT')) // rebaseStart
        .mockResolvedValueOnce(undefined); // rebaseAbort --abort

      const result = await manager.rebase(42);

      expect(result).toMatchObject({ success: false, conflicts: ['src/file.ts'] });
    });

    it('calls rebaseAbort when rebaseStart returns conflict', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.rebase
        .mockRejectedValueOnce(new Error('CONFLICT'))
        .mockResolvedValueOnce(undefined);

      await manager.rebase(42);

      // rebaseAbort calls worktreeGit.rebase(['--abort'])
      expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    });
  });

  // ── rebaseContinue ───────────────────────────────────────────────────────

  describe('rebaseContinue', () => {
    it('returns success:true when git rebase --continue succeeds', async () => {
      mockGit.raw.mockResolvedValue(''); // git add -A
      mockEnvGit.rebase.mockResolvedValue(undefined);

      const result = await manager.rebaseContinue(42);

      expect(result).toEqual({ success: true });
    });

    it('stages all changes before continuing', async () => {
      mockGit.raw.mockResolvedValue('');
      mockEnvGit.rebase.mockResolvedValue(undefined);

      await manager.rebaseContinue(42);

      expect(mockGit.raw).toHaveBeenCalledWith(['add', '-A']);
    });

    it('calls rebase --continue with GIT_EDITOR=true in env', async () => {
      mockGit.raw.mockResolvedValue('');
      mockEnvGit.rebase.mockResolvedValue(undefined);

      await manager.rebaseContinue(42);

      expect(mockGit.env).toHaveBeenCalledWith(
        expect.objectContaining({ GIT_EDITOR: 'true' }),
      );
      expect(mockEnvGit.rebase).toHaveBeenCalledWith(['--continue']);
    });

    it('returns success:true when error message contains "no rebase in progress"', async () => {
      mockGit.raw.mockResolvedValue('');
      mockEnvGit.rebase.mockRejectedValue(new Error('no rebase in progress'));
      // diff call returns empty (no conflict markers)
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });

      const result = await manager.rebaseContinue(42);

      expect(result.success).toBe(true);
    });

    it('returns success:false with conflictedFiles when files still have conflicts', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args.includes('--diff-filter=U'))
          return Promise.resolve('src/still-broken.ts\n');
        return Promise.resolve('');
      });
      mockEnvGit.rebase.mockRejectedValue(new Error('some git error'));

      const result = await manager.rebaseContinue(42);

      expect(result.success).toBe(false);
      expect(result.conflictedFiles).toEqual(['src/still-broken.ts']);
    });

    it('returns success:false with error string for unexpected git errors', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });
      mockEnvGit.rebase.mockRejectedValue(new Error('fatal: unexpected error'));

      const result = await manager.rebaseContinue(42);

      expect(result.success).toBe(false);
      expect(result.error).toContain('fatal: unexpected error');
    });

    it('logs info on successful continue', async () => {
      mockGit.raw.mockResolvedValue('');
      mockEnvGit.rebase.mockResolvedValue(undefined);

      await manager.rebaseContinue(42);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rebase continued successfully for issue #42'),
        expect.any(Object),
      );
    });
  });

  // ── rebaseAbort ──────────────────────────────────────────────────────────

  describe('rebaseAbort', () => {
    it('calls git rebase --abort', async () => {
      await manager.rebaseAbort(42);

      expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    });

    it('logs info on successful abort', async () => {
      await manager.rebaseAbort(42);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rebase aborted for issue #42'),
        expect.any(Object),
      );
    });

    it('does not throw when rebase --abort fails (already clean state)', async () => {
      mockGit.rebase.mockRejectedValue(new Error('no rebase in progress'));

      await expect(manager.rebaseAbort(42)).resolves.toBeUndefined();
    });
  });

  // ── listActive ───────────────────────────────────────────────────────────

  describe('listActive', () => {
    it('returns empty array when no worktrees match cadre root', async () => {
      mockGit.raw.mockResolvedValue('worktree /other/path\nbranch refs/heads/main\n\n');

      const result = await manager.listActive();

      expect(result).toEqual([]);
    });

    it('parses and returns worktrees managed by cadre', async () => {
      const porcelain = [
        'worktree /tmp/worktrees/issue-7',
        'HEAD abc123',
        'branch refs/heads/cadre/issue-7',
        '',
        'worktree /tmp/worktrees/issue-9',
        'HEAD def456',
        'branch refs/heads/cadre/issue-9',
        '',
      ].join('\n');
      // raw: worktree list --porcelain; then revparse for baseCommit of each
      mockGit.raw
        .mockResolvedValueOnce(porcelain) // worktree list
        .mockResolvedValue(''); // revparse fallback inside getBaseCommit (uses simpleGit)
      mockGit.revparse.mockResolvedValue('abc123');

      const result = await manager.listActive();

      expect(result).toHaveLength(2);
      expect(result[0].issueNumber).toBe(7);
      expect(result[1].issueNumber).toBe(9);
    });

    it('ignores worktree blocks without an issue-<n> path', async () => {
      const porcelain = [
        'worktree /tmp/worktrees/some-other-dir',
        'HEAD abc123',
        'branch refs/heads/feature/stuff',
        '',
      ].join('\n');
      mockGit.raw.mockResolvedValueOnce(porcelain);

      const result = await manager.listActive();

      expect(result).toEqual([]);
    });

    it('includes branch, path, and exists=true in each result', async () => {
      const porcelain = [
        'worktree /tmp/worktrees/issue-3',
        'HEAD abc123',
        'branch refs/heads/cadre/issue-3',
        '',
      ].join('\n');
      mockGit.raw.mockResolvedValueOnce(porcelain).mockResolvedValue('');
      mockGit.revparse.mockResolvedValue('headsha');

      const result = await manager.listActive();

      expect(result[0]).toMatchObject({
        issueNumber: 3,
        path: '/tmp/worktrees/issue-3',
        branch: 'cadre/issue-3',
        exists: true,
      });
    });
  });

  // ── exists ───────────────────────────────────────────────────────────────

  describe('exists', () => {
    it('returns true when the worktree directory exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);

      const result = await manager.exists(42);

      expect(result).toBe(true);
    });

    it('returns false when the worktree directory does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      const result = await manager.exists(42);

      expect(result).toBe(false);
    });

    it('checks the correct path for the issue number', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);

      await manager.exists(55);

      expect(fsUtils.exists).toHaveBeenCalledWith('/tmp/worktrees/issue-55');
    });
  });
});
