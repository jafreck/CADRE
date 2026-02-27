import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simpleGit } from 'simple-git';
import * as fsp from 'node:fs/promises';
import { DependencyBranchMerger } from '../src/git/dependency-branch-merger.js';
import { DependencyMergeConflictError } from '../src/errors.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

// Mock node:fs/promises so we can assert dep-conflict.json writes without touching disk
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn().mockResolvedValue(''),
    revparse: vi.fn().mockResolvedValue('depshead\n'),
    branch: vi.fn().mockResolvedValue(undefined),
    branchLocal: vi.fn().mockResolvedValue({ all: [] }),
    merge: vi.fn().mockResolvedValue(undefined),
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
}));

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

describe('DependencyBranchMerger', () => {
  let merger: DependencyBranchMerger;
  let mockGit: ReturnType<typeof simpleGit>;
  let mockLogger: Logger;
  const resolveBranchName = (n: number, t: string) => `cadre/issue-${n}`;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockGit = simpleGit('/tmp/repo');
    vi.clearAllMocks();

    (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });
    (mockGit.branch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');
    (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('depshead\n');
    (mockGit.merge as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    merger = new DependencyBranchMerger(mockGit, '/tmp/repo', mockLogger, resolveBranchName);
  });

  it('should export DependencyBranchMerger class', () => {
    expect(DependencyBranchMerger).toBeDefined();
  });

  it('should expose mergeDependencies method', () => {
    expect(typeof merger.mergeDependencies).toBe('function');
  });

  describe('successful multi-dep merge', () => {
    it('should call deps worktree preparation callback after creating worktree', async () => {
      const prepareDepsWorktree = vi.fn().mockResolvedValue(undefined);

      await merger.mergeDependencies(
        42,
        [],
        'basesha',
        '/tmp/worktrees',
        undefined,
        prepareDepsWorktree,
      );

      expect(prepareDepsWorktree).toHaveBeenCalledOnce();
      expect(prepareDepsWorktree).toHaveBeenCalledWith('/tmp/worktrees/deps-42', 42);
    });

    it('should create deps branch from baseCommit when it does not exist', async () => {
      await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

      expect(mockGit.branch).toHaveBeenCalledWith(['cadre/deps-42', 'basesha']);
    });

    it('should add a temporary worktree for the deps branch', async () => {
      await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'add']),
      );
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

    it('should merge each dep branch in the order provided', async () => {
      const mergeFn = vi.fn().mockResolvedValue(undefined);
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = mergeFn;

      const deps = [makeDep(10, 'first dep'), makeDep(20, 'second dep'), makeDep(30, 'third dep')];
      await merger.mergeDependencies(42, deps, 'basesha', '/tmp/worktrees');

      expect(mergeFn).toHaveBeenCalledTimes(3);
      const mergeArgs = mergeFn.mock.calls.map((c: string[][]) => c[0][0]);
      expect(mergeArgs[0]).toContain('issue-10');
      expect(mergeArgs[1]).toContain('issue-20');
      expect(mergeArgs[2]).toContain('issue-30');
    });

    it('should remove the temporary deps worktree after successful merges', async () => {
      await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

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

    it('should return the HEAD SHA of the merged deps branch', async () => {
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('mergedsha\n');

      const result = await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

      expect(result).toBe('mergedsha');
    });
  });

  describe('conflict on first dep', () => {
    beforeEach(() => {
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        return Promise.resolve('');
      });
    });

    it('should throw DependencyMergeConflictError when first dep conflicts', async () => {
      const dep = makeDep(10, 'dep issue');
      await expect(merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees')).rejects.toThrow(
        DependencyMergeConflictError,
      );
    });

    it('should include correct issueNumber and conflictingBranch in error', async () => {
      const dep = makeDep(10, 'dep issue');
      let thrown: DependencyMergeConflictError | undefined;
      try {
        await merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees');
      } catch (e) {
        thrown = e as DependencyMergeConflictError;
      }

      expect(thrown).toBeDefined();
      expect(thrown!.issueNumber).toBe(42);
      expect(thrown!.conflictingBranch).toContain('issue-10');
    });

    it('should write dep-conflict.json with required fields', async () => {
      const mockWriteFile = vi.mocked(fsp.writeFile);
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\nsrc/bar.ts\n');
        return Promise.resolve('');
      });

      const dep = makeDep(10, 'dep issue');
      await expect(merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees')).rejects.toThrow(
        DependencyMergeConflictError,
      );

      const conflictWrite = mockWriteFile.mock.calls.find((args) =>
        String(args[0]).endsWith('dep-conflict.json'),
      );
      expect(conflictWrite).toBeDefined();

      const writtenContent = JSON.parse(conflictWrite![1] as string);
      expect(writtenContent.issueNumber).toBe(42);
      expect(writtenContent.conflictingBranch).toContain('issue-10');
      expect(Array.isArray(writtenContent.conflictedFiles)).toBe(true);
      expect(writtenContent.conflictedFiles).toContain('src/foo.ts');
      expect(typeof writtenContent.timestamp).toBe('string');
      expect(() => new Date(writtenContent.timestamp).toISOString()).not.toThrow();
    });

    it('should remove the temporary deps worktree even when conflict occurs', async () => {
      const dep = makeDep(10, 'dep issue');
      await expect(merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees')).rejects.toThrow(
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

    it('should delete the deps branch on failure so retries can recreate it', async () => {
      const dep = makeDep(10, 'dep issue');
      await expect(merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees')).rejects.toThrow(
        DependencyMergeConflictError,
      );

      expect(mockGit.branch).toHaveBeenCalledWith(['-D', 'cadre/deps-42']);
    });

    it('uses resolver callback and continues merge when callback resolves conflict', async () => {
      const dep = makeDep(10, 'dep issue');
      const resolver = vi.fn().mockResolvedValue(true);

      await expect(
        merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees', resolver),
      ).resolves.toBe('depshead');

      expect(resolver).toHaveBeenCalledOnce();
      expect((mockGit.raw as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(['add', '-A']);
      expect((mockGit.raw as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(['commit', '--no-edit']);
    });

    it('still throws when resolver callback returns false', async () => {
      const dep = makeDep(10, 'dep issue');
      const resolver = vi.fn().mockResolvedValue(false);

      await expect(
        merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees', resolver),
      ).rejects.toThrow(DependencyMergeConflictError);
    });

    it('falls back to dep-merge-conflict when resolver succeeds but commit fails', async () => {
      const dep = makeDep(10, 'dep issue');
      const resolver = vi.fn().mockResolvedValue(true);

      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi
        .fn()
        .mockRejectedValue(new Error('CONFLICTS'));

      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/foo.ts\n');
        if (Array.isArray(args) && args[0] === 'commit') return Promise.reject(new Error('commit failed'));
        return Promise.resolve('');
      });

      await expect(
        merger.mergeDependencies(42, [dep], 'basesha', '/tmp/worktrees', resolver),
      ).rejects.toThrow(DependencyMergeConflictError);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('merge commit failed'),
        expect.objectContaining({ issueNumber: 42 }),
      );
    });
  });

  describe('conflict on second dep', () => {
    it('should throw DependencyMergeConflictError with the second conflicting branch', async () => {
      let callCount = 0;
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('CONFLICTS'));
        return Promise.resolve(undefined);
      });
      (mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) => {
        if (Array.isArray(args) && args[0] === 'diff') return Promise.resolve('src/baz.ts\n');
        return Promise.resolve('');
      });

      const deps = [makeDep(10, 'first dep'), makeDep(20, 'second dep')];
      let thrown: DependencyMergeConflictError | undefined;
      try {
        await merger.mergeDependencies(42, deps, 'basesha', '/tmp/worktrees');
      } catch (e) {
        thrown = e as DependencyMergeConflictError;
      }

      expect(thrown).toBeInstanceOf(DependencyMergeConflictError);
      expect(thrown!.conflictingBranch).toContain('issue-20');
    });
  });

  describe('deps branch already exists (resume path)', () => {
    it('should not create the deps branch when it already exists', async () => {
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/deps-42'] });

      await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

      // branch() should NOT be called for creating the deps branch
      expect(mockGit.branch).not.toHaveBeenCalledWith(
        expect.arrayContaining(['cadre/deps-42', 'basesha']),
      );
    });

    it('should still create the temp worktree and merge when deps branch exists', async () => {
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/deps-42'] });
      const mergeFn = vi.fn().mockResolvedValue(undefined);
      (mockGit as Record<string, ReturnType<typeof vi.fn>>)['merge'] = mergeFn;

      const deps = [makeDep(10, 'dep issue')];
      await merger.mergeDependencies(42, deps, 'basesha', '/tmp/worktrees');

      expect(mergeFn).toHaveBeenCalledTimes(1);
    });

    it('should return the HEAD SHA of the existing deps branch after merges', async () => {
      (mockGit.branchLocal as ReturnType<typeof vi.fn>).mockResolvedValue({ all: ['cadre/deps-42'] });
      (mockGit.revparse as ReturnType<typeof vi.fn>).mockResolvedValue('resumesha\n');

      const result = await merger.mergeDependencies(42, [], 'basesha', '/tmp/worktrees');

      expect(result).toBe('resumesha');
    });
  });
});
