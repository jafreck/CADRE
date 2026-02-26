import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import * as fsp from 'node:fs/promises';
import { WorktreeProvisioner, RemoteBranchMissingError } from '../src/git/worktree-provisioner.js';
import { DependencyMergeConflictError } from '../src/errors.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
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
    rebase: vi.fn().mockResolvedValue(undefined),
    env: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    addConfig: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
  };
  mockGit.env.mockReturnValue({ rebase: vi.fn().mockResolvedValue(undefined) });
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

describe('WorktreeProvisioner', () => {
  let provisioner: WorktreeProvisioner;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    provisioner = new WorktreeProvisioner(
      '/tmp/repo',
      '/tmp/worktrees',
      'main',
      'cadre/issue-{issue}',
      mockLogger,
    );
  });

  // ── resolveBranchName ──────────────────────────────────────────────────────

  describe('resolveBranchName', () => {
    it('replaces {issue} placeholder', () => {
      expect(provisioner.resolveBranchName(42)).toBe('cadre/issue-42');
    });

    it('replaces {title} placeholder', () => {
      const p = new WorktreeProvisioner('/tmp/repo', '/tmp/worktrees', 'main', 'cadre/{issue}-{title}', mockLogger);
      expect(p.resolveBranchName(42, 'Fix Login Timeout')).toBe('cadre/42-fix-login-timeout');
    });

    it('sanitizes special characters from title', () => {
      const p = new WorktreeProvisioner('/tmp/repo', '/tmp/worktrees', 'main', 'cadre/{issue}-{title}', mockLogger);
      const name = p.resolveBranchName(42, 'Fix: weird @chars! (here)');
      expect(name).not.toMatch(/[@!()]/);
    });

    it('truncates long branch names to 100 chars', () => {
      const p = new WorktreeProvisioner('/tmp/repo', '/tmp/worktrees', 'main', 'cadre/{issue}-{title}', mockLogger);
      const name = p.resolveBranchName(42, 'a'.repeat(200));
      expect(name.length).toBeLessThanOrEqual(100);
    });
  });

  // ── getWorktreePath ────────────────────────────────────────────────────────

  describe('getWorktreePath', () => {
    it('returns the correct path for an issue number', () => {
      expect(provisioner.getWorktreePath(42)).toBe('/tmp/worktrees/issue-42');
    });

    it('includes the issue number in the path', () => {
      expect(provisioner.getWorktreePath(100)).toContain('issue-100');
    });
  });

  // ── exists ─────────────────────────────────────────────────────────────────

  describe('exists', () => {
    it('returns true when the worktree directory exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      expect(await provisioner.exists(42)).toBe(true);
    });

    it('returns false when the worktree directory does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      expect(await provisioner.exists(42)).toBe(false);
    });

    it('checks the correct path for the issue number', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      await provisioner.exists(55);
      expect(fsUtils.exists).toHaveBeenCalledWith('/tmp/worktrees/issue-55');
    });
  });

  // ── prefetch ───────────────────────────────────────────────────────────────

  describe('prefetch', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
    });

    it('calls git.fetch with origin and baseBranch', async () => {
      await provisioner.prefetch();
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });

    it('logs debug message on successful fetch', async () => {
      await provisioner.prefetch();
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetched origin/main');
    });

    it('does not throw when fetch fails', async () => {
      (mockGit.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
      await expect(provisioner.prefetch()).resolves.toBeUndefined();
    });

    it('logs warn when fetch fails', async () => {
      (mockGit.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
      await provisioner.prefetch();
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to fetch origin/main, continuing with local');
    });
  });

  // ── provision (fresh) ──────────────────────────────────────────────────────

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

    it('creates a fresh worktree when worktree does not exist', async () => {
      const result = await provisioner.provision(42, 'my issue');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
      expect(result.branch).toBe('cadre/issue-42');
    });

    it('calls git worktree add with the correct path', async () => {
      await provisioner.provision(42, 'my issue');
      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'add', '/tmp/worktrees/issue-42']),
      );
    });

    it('creates branch from base commit when branch does not exist locally', async () => {
      await provisioner.provision(42, 'my issue');
      expect(mockGit.branch).toHaveBeenCalledWith(
        expect.arrayContaining(['cadre/issue-42', 'basesha']),
      );
    });

    it('skips branch creation when branch already exists locally', async () => {
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/issue-42'] });
      await provisioner.provision(42, 'my issue');
      expect(mockGit.branch).not.toHaveBeenCalled();
    });

    it('falls back to local base branch when origin/<base> revparse fails', async () => {
      (mockGit.revparse as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('unknown revision origin/main'))
        .mockResolvedValueOnce('localsha');
      const result = await provisioner.provision(42, 'my issue');
      expect(result.baseCommit).toBe('localsha');
    });

    it('returns syncedAgentFiles in the result', async () => {
      const result = await provisioner.provision(42, 'my issue');
      expect(Array.isArray(result.syncedAgentFiles)).toBe(true);
    });

    it('logs info after provisioning', async () => {
      await provisioner.provision(42, 'my issue');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Provisioned worktree for issue #42'),
        expect.any(Object),
      );
    });
  });

  // ── provision (resume) ─────────────────────────────────────────────────────

  describe('provision (resume path)', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('abc123');
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
    });

    it('returns existing WorktreeInfo when worktree already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      const result = await provisioner.provision(42, 'my issue');
      expect(result.issueNumber).toBe(42);
      expect(result.exists).toBe(true);
    });

    it('throws RemoteBranchMissingError when resume=true and remote branch is absent', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
      await expect(provisioner.provision(42, 'my issue', true)).rejects.toThrow(RemoteBranchMissingError);
    });

    it('fetches and creates worktree when resume=true and remote branch exists', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('abc123\trefs/heads/cadre/issue-42')
        .mockResolvedValue('');
      const result = await provisioner.provision(42, 'my issue', true);
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
      expect(result.exists).toBe(true);
    });
  });

  // ── provisionFromBranch ────────────────────────────────────────────────────

  describe('provisionFromBranch', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('def456\n');
    });

    it('fetches the remote branch when worktree does not exist', async () => {
      await provisioner.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'cadre/issue-42');
    });

    it('adds git worktree with -B flag', async () => {
      await provisioner.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add', '-B', 'cadre/issue-42', '/tmp/worktrees/issue-42', 'origin/cadre/issue-42',
      ]);
    });

    it('returns a WorktreeInfo with correct fields', async () => {
      const result = await provisioner.provisionFromBranch(42, 'cadre/issue-42');
      expect(result).toMatchObject({ issueNumber: 42, branch: 'cadre/issue-42', exists: true });
    });

    it('returns existing worktree without re-provisioning when it already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      await provisioner.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockGit.fetch).not.toHaveBeenCalled();
    });

    it('logs info after provisioning from branch', async () => {
      await provisioner.provisionFromBranch(42, 'cadre/issue-42');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Provisioned worktree from branch'),
        expect.anything(),
      );
    });
  });

  // ── provisionWithDeps ──────────────────────────────────────────────────────

  describe('provisionWithDeps', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    const makeDep = (number: number, title: string) => ({
      number, title, body: '', labels: [], assignees: [], comments: [],
      state: 'open' as const, createdAt: '', updatedAt: '', linkedPRs: [],
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

    it('creates deps branch from baseBranch', async () => {
      await provisioner.provisionWithDeps(42, 'my issue', []);
      expect(mockGit.branch).toHaveBeenCalledWith(expect.arrayContaining(['cadre/deps-42']));
    });

    it('adds a temporary worktree for the deps branch', async () => {
      await provisioner.provisionWithDeps(42, 'my issue', []);
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const depsWorktreeAdd = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0][0] === 'worktree' && args[0][1] === 'add' && (args[0][2] as string)?.includes('deps-42'),
      );
      expect(depsWorktreeAdd).toBeDefined();
    });

    it('creates the issue branch from the deps branch HEAD', async () => {
      await provisioner.provisionWithDeps(42, 'my issue', []);
      expect(mockGit.branch).toHaveBeenCalledWith(expect.arrayContaining(['cadre/issue-42']));
    });

    it('returns WorktreeInfo with issue branch name (not deps branch)', async () => {
      const result = await provisioner.provisionWithDeps(42, 'my issue', []);
      expect(result.branch).toBe('cadre/issue-42');
      expect(result.branch).not.toContain('deps');
    });

    it('returns WorktreeInfo with correct issueNumber and path', async () => {
      const result = await provisioner.provisionWithDeps(42, 'my issue', []);
      expect(result.issueNumber).toBe(42);
      expect(result.path).toBe('/tmp/worktrees/issue-42');
      expect(result.exists).toBe(true);
    });

    it('removes the temp deps worktree after successful merges', async () => {
      await provisioner.provisionWithDeps(42, 'my issue', []);
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls;
      const worktreeRemove = rawCalls.find(
        (args: string[][]) => Array.isArray(args[0]) && args[0][0] === 'worktree' && args[0][1] === 'remove' && (args[0][2] as string)?.includes('deps-42'),
      );
      expect(worktreeRemove).toBeDefined();
    });

    it('returns existing worktree info if directory already exists', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      const result = await provisioner.provisionWithDeps(42, 'my issue', []);
      expect(result.issueNumber).toBe(42);
      expect(mockGit.branch).not.toHaveBeenCalled();
    });

    it('throws DependencyMergeConflictError on merge conflict', async () => {
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi.fn().mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        return Promise.resolve('');
      });
      await expect(provisioner.provisionWithDeps(42, 'my issue', [makeDep(10, 'dep issue')])).rejects.toThrow(DependencyMergeConflictError);
    });

    it('merges each dep branch in the order provided', async () => {
      const mergeFn = vi.fn().mockResolvedValue(undefined);
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = mergeFn;
      const deps = [makeDep(10, 'first dep'), makeDep(20, 'second dep'), makeDep(30, 'third dep')];
      await provisioner.provisionWithDeps(42, 'my issue', deps);
      expect(mergeFn).toHaveBeenCalledTimes(3);
      const mergeArgs = mergeFn.mock.calls.map((c: string[][]) => c[0][0]);
      expect(mergeArgs[0]).toContain('issue-10');
      expect(mergeArgs[1]).toContain('issue-20');
      expect(mergeArgs[2]).toContain('issue-30');
    });
  });

  // ── rebaseStart ────────────────────────────────────────────────────────────

  describe('rebaseStart', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/repo/.git');
      (mockGit.rebase as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('returns clean when rebase succeeds', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      const result = await provisioner.rebaseStart(42);
      expect(result).toEqual({ status: 'clean' });
    });

    it('fetches origin/<baseBranch> before rebasing', async () => {
      mockGit.raw.mockResolvedValue('/tmp/repo/.git');
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      await provisioner.rebaseStart(42);
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });

    it('returns conflict with conflicted files when rebase throws', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/foo.ts\nsrc/bar.ts\n');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.rebase.mockRejectedValue(new Error('CONFLICT'));
      const result = await provisioner.rebaseStart(42);
      expect(result).toMatchObject({ status: 'conflict', conflictedFiles: ['src/foo.ts', 'src/bar.ts'] });
    });

    it('detects an already-paused rebase and skips fetch', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockImplementation(async (p: string) => {
        return typeof p === 'string' && p.includes('rebase-merge');
      });
      const result = await provisioner.rebaseStart(42);
      expect(result).toMatchObject({ status: 'conflict' });
      expect(mockGit.fetch).not.toHaveBeenCalled();
    });

    it('logs warn when already-paused rebase is detected', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        return Promise.resolve('');
      });
      vi.mocked(fsUtils.exists).mockImplementation(async (p: string) => {
        return typeof p === 'string' && p.includes('rebase-merge');
      });
      await provisioner.rebaseStart(42);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('rebase is already paused'),
        expect.any(Object),
      );
    });
  });

  // ── rebaseContinue ─────────────────────────────────────────────────────────

  describe('rebaseContinue', () => {
    let mockGit: ReturnType<typeof simpleGit>;
    let mockEnvGit: { rebase: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      mockEnvGit = { rebase: vi.fn().mockResolvedValue(undefined) };
      (mockGit.env as ReturnType<typeof vi.fn>).mockReturnValue(mockEnvGit);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    });

    it('returns success:true when git rebase --continue succeeds', async () => {
      const result = await provisioner.rebaseContinue(42);
      expect(result).toEqual({ success: true });
    });

    it('stages all changes before continuing', async () => {
      await provisioner.rebaseContinue(42);
      expect(mockGit.raw).toHaveBeenCalledWith(['add', '-A']);
    });

    it('calls rebase --continue with GIT_EDITOR=true in env', async () => {
      await provisioner.rebaseContinue(42);
      expect(mockGit.env).toHaveBeenCalledWith(expect.objectContaining({ GIT_EDITOR: 'true' }));
      expect(mockEnvGit.rebase).toHaveBeenCalledWith(['--continue']);
    });

    it('returns success:true when error message contains "no rebase in progress"', async () => {
      mockEnvGit.rebase.mockRejectedValue(new Error('no rebase in progress'));
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('');
        return Promise.resolve('');
      });
      const result = await provisioner.rebaseContinue(42);
      expect(result.success).toBe(true);
    });

    it('returns success:false with conflictedFiles when files still have conflicts', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/still-broken.ts\n');
        return Promise.resolve('');
      });
      mockEnvGit.rebase.mockRejectedValue(new Error('some git error'));
      const result = await provisioner.rebaseContinue(42);
      expect(result.success).toBe(false);
      expect(result.conflictedFiles).toEqual(['src/still-broken.ts']);
    });
  });

  // ── rebaseAbort ────────────────────────────────────────────────────────────

  describe('rebaseAbort', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      (mockGit.rebase as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('calls git rebase --abort', async () => {
      await provisioner.rebaseAbort(42);
      expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    });

    it('logs info on successful abort', async () => {
      await provisioner.rebaseAbort(42);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Rebase aborted for issue #42'),
        expect.any(Object),
      );
    });

    it('does not throw when rebase --abort fails', async () => {
      mockGit.rebase.mockRejectedValue(new Error('no rebase in progress'));
      await expect(provisioner.rebaseAbort(42)).resolves.toBeUndefined();
    });
  });

  // ── rebase ─────────────────────────────────────────────────────────────────

  describe('rebase', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
      vi.mocked(fsUtils.exists).mockResolvedValue(false);
      mockGit.raw.mockResolvedValue('/tmp/repo/.git');
      mockGit.rebase.mockResolvedValue(undefined);
    });

    it('returns success:true when rebaseStart returns clean', async () => {
      const result = await provisioner.rebase(42);
      expect(result).toEqual({ success: true });
    });

    it('aborts and returns success:false with conflicts on conflict', async () => {
      mockGit.raw.mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'rev-parse') return Promise.resolve('/tmp/repo/.git');
        if (Array.isArray(args) && args.includes('--diff-filter=U')) return Promise.resolve('src/file.ts\n');
        return Promise.resolve('');
      });
      mockGit.rebase
        .mockRejectedValueOnce(new Error('CONFLICT'))
        .mockResolvedValueOnce(undefined);
      const result = await provisioner.rebase(42);
      expect(result).toMatchObject({ success: false, conflicts: ['src/file.ts'] });
    });
  });

  // ── listActive ─────────────────────────────────────────────────────────────

  describe('listActive', () => {
    let mockGit: ReturnType<typeof simpleGit>;

    beforeEach(() => {
      mockGit = simpleGit('/tmp/repo');
      vi.clearAllMocks();
    });

    it('returns empty array when no worktrees match cadre root', async () => {
      mockGit.raw.mockResolvedValue('worktree /other/path\nbranch refs/heads/main\n\n');
      const result = await provisioner.listActive();
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
      mockGit.raw.mockResolvedValueOnce(porcelain).mockResolvedValue('');
      mockGit.revparse.mockResolvedValue('abc123');
      const result = await provisioner.listActive();
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
      const result = await provisioner.listActive();
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
      const result = await provisioner.listActive();
      expect(result[0]).toMatchObject({
        issueNumber: 3,
        path: '/tmp/worktrees/issue-3',
        branch: 'cadre/issue-3',
        exists: true,
      });
    });
  });

  // ── RemoteBranchMissingError ───────────────────────────────────────────────

  describe('RemoteBranchMissingError', () => {
    it('extends Error', () => {
      expect(new RemoteBranchMissingError('cadre/issue-42')).toBeInstanceOf(Error);
    });

    it('has name RemoteBranchMissingError', () => {
      expect(new RemoteBranchMissingError('cadre/issue-42').name).toBe('RemoteBranchMissingError');
    });

    it('includes branch name in message', () => {
      expect(new RemoteBranchMissingError('cadre/issue-42').message).toContain('cadre/issue-42');
    });
  });
});
