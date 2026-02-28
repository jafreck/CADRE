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
    it('should call git restore --staged for core cadre patterns after staging all', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await manager.commit('fix: something', 1, 'fix');

      expect(mockGit.add).toHaveBeenCalledWith(['-A']);

      // Each pattern is now restored individually, so collect all per-pattern args.
      const restoreCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'restore' &&
          args[0].includes('--staged'),
      );
      expect(restoreCalls.length).toBeGreaterThan(0);

      const allPatterns: string[] = restoreCalls.flatMap(
        (call: string[][]) => call[0].slice(call[0].indexOf('--') + 1),
      );
      expect(allPatterns).toContain('.cadre/');
      expect(allPatterns).toContain('task-*.md');
    });

    it('should unstage exact agent file paths passed at construction, not whole directories', async () => {
      const agentFiles = [
        '.github/agents/code-writer.agent.md',
        '.github/agents/codebase-scout.agent.md',
      ];
      const managerWithAgents = new CommitManager(
        '/tmp/worktree',
        { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false } as CadreConfig['commits'],
        mockLogger,
        agentFiles,
      );

      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await managerWithAgents.commit('feat: something', 1, 'feat');

      const restoreCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'restore' &&
          args[0].includes('--staged'),
      );
      // Each pattern is restored in its own call — collect all path args.
      const allPatterns: string[] = restoreCalls.flatMap(
        (call: string[][]) => call[0].slice(call[0].indexOf('--') + 1),
      );

      // Exact file paths — not broad directory patterns
      expect(allPatterns).toContain('.github/agents/code-writer.agent.md');
      expect(allPatterns).toContain('.github/agents/codebase-scout.agent.md');
      // Must NOT use broad patterns that would affect the target repo's own agents
      expect(allPatterns).not.toContain('.github/agents/');
      expect(allPatterns).not.toContain('.claude/agents/');
    });

    it('should not commit .cadre/ or task-*.md files', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => true, staged: [], files: [] });

      const sha = await manager.commit('chore: update', 1);
      expect(sha).toBe('');
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should work cleanly when no agent files were synced', async () => {
      // Default manager has syncedAgentFiles = [] — only core patterns should be restored
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await expect(manager.commit('feat: something', 1)).resolves.toBeDefined();

      const restoreCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: string[][]) => Array.isArray(args[0]) && args[0][0] === 'restore',
      );
      // Each pattern is its own call; collect all path args from --staged calls.
      const allPatterns: string[] = restoreCalls
        .filter((call: string[][]) => call[0].includes('--staged'))
        .flatMap((call: string[][]) => call[0].slice(call[0].indexOf('--') + 1));
      expect(allPatterns).toContain('.cadre/');
      expect(allPatterns).toContain('task-*.md');
      // No extra paths beyond the two core patterns
      expect(allPatterns).toEqual(['.cadre/', 'task-*.md']);
    });
  });

  describe('stripCadreFiles', () => {
    it('should hard-reset to base, cherry-pick each commit, strip cadre files, and recommit with original metadata', async () => {
      // First raw call is git log; subsequent are cherry-pick, restores, commit -C
      mockGit.raw
        .mockResolvedValueOnce('deadbeef\n') // git log --format=%H --reverse
        .mockResolvedValue('');              // all subsequent raw calls

      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await manager.stripCadreFiles('base123');

      expect(mockGit.reset).toHaveBeenCalledWith(['--hard', 'base123']);

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const cherryPickCall = rawCalls.find(
        ([args]) => args.includes('cherry-pick') && args.includes('--no-commit'),
      );
      expect(cherryPickCall).toBeDefined();
      expect(cherryPickCall![0]).toContain('deadbeef');

      const commitCall = rawCalls.find(
        ([args]) => args[0] === 'commit' && args.includes('-C'),
      );
      expect(commitCall).toBeDefined();
      expect(commitCall![0]).toContain('deadbeef');
    });

    it('should include syncedAgentFiles in the restore patterns', async () => {
      const agentFiles = ['.github/agents/code-writer.agent.md'];
      const managerWithAgents = new CommitManager(
        '/tmp/worktree',
        { conventional: false, sign: false, commitPerPhase: false, squashBeforePR: false } as CadreConfig['commits'],
        mockLogger,
        agentFiles,
      );

      mockGit.raw
        .mockResolvedValueOnce('deadbeef\n')
        .mockResolvedValue('');

      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await managerWithAgents.stripCadreFiles('base123');

      // Each pattern is its own restore call — collect all patterns from --staged calls.
      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const allPatterns: string[] = rawCalls
        .filter(([args]) => args.includes('restore') && args.includes('--staged'))
        .flatMap(([args]) => args.slice(args.indexOf('--') + 1));
      expect(allPatterns).toContain('.github/agents/code-writer.agent.md');
    });

    it('should drop a cadre-only commit and not call commit -C for it', async () => {
      mockGit.raw
        .mockResolvedValueOnce('deadbeef\n')
        .mockResolvedValue('');

      // Nothing staged after stripping — commit was cadre-only
      mockGit.status.mockResolvedValue({
        isClean: () => true,
        staged: [],
        files: [],
      });

      await manager.stripCadreFiles('base123');

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const commitCall = rawCalls.find(
        ([args]) => args[0] === 'commit' && args.includes('-C'),
      );
      expect(commitCall).toBeUndefined();

      // Should have called cherry-pick --quit to clean up CHERRY_PICK_HEAD
      const quitCall = rawCalls.find(
        ([args]) => args.includes('cherry-pick') && args.includes('--quit'),
      );
      expect(quitCall).toBeDefined();
    });

    it('should return early without resetting when there are no commits to rewrite', async () => {
      mockGit.raw.mockResolvedValueOnce(''); // git log returns nothing

      await manager.stripCadreFiles('base123');

      expect(mockGit.reset).not.toHaveBeenCalled();
    });

    it('should not throw when cherry-pick or restore fail', async () => {
      mockGit.raw
        .mockResolvedValueOnce('deadbeef\n')
        .mockRejectedValueOnce(new Error('cherry-pick conflict')) // cherry-pick
        .mockResolvedValue('');

      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await expect(manager.stripCadreFiles('base123')).resolves.toBeUndefined();
    });
  });

  describe('commit with sign', () => {
    it('should pass -S option when sign is enabled', async () => {
      const signedConfig = {
        conventional: false,
        sign: true,
        commitPerPhase: true,
        squashBeforePR: false,
      } as CadreConfig['commits'];
      const signedManager = new CommitManager('/tmp/worktree', signedConfig, mockLogger);

      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      await signedManager.commit('chore: signed commit', 1);

      expect(mockGit.commit).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.objectContaining({ '-S': null }),
      );
    });
  });

  describe('unstageArtifacts error handling', () => {
    it('should continue without throwing when git restore --staged throws for a pattern', async () => {
      // First raw call in the commit path is git restore for the first pattern (.cadre/) — make it fail.
      // The remaining patterns should still be attempted individually.
      mockGit.raw
        .mockRejectedValueOnce(new Error('git restore not supported'))
        .mockResolvedValue(''); // subsequent restore calls succeed
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/index.ts'],
        files: [{ path: 'src/index.ts' }],
      });

      // Should not throw — individual restore errors are swallowed per-pattern.
      await expect(manager.commit('fix: something', 1)).resolves.toBeDefined();
      // The overall completion debug message should still be logged.
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unstaged'),
        expect.any(Object),
      );
    });
  });

  describe('commitFiles', () => {
    it('should return empty string when files list is empty', async () => {
      const result = await manager.commitFiles([], 'chore: nothing', 1);
      expect(result).toBe('');
      expect(mockGit.add).not.toHaveBeenCalled();
    });

    it('should return empty string when nothing is staged after adding files', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => true, staged: [], files: [] });

      const result = await manager.commitFiles(['src/foo.ts'], 'fix: something', 1);
      expect(result).toBe('');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Nothing to commit after staging'),
        expect.any(Object),
      );
    });

    it('should stage specified files and commit them', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/foo.ts'],
        files: [{ path: 'src/foo.ts' }],
      });
      mockGit.commit.mockResolvedValueOnce({ commit: 'deadbeef' });

      const result = await manager.commitFiles(['src/foo.ts'], 'fix: something', 42);

      expect(mockGit.add).toHaveBeenCalledWith(['src/foo.ts']);
      expect(mockGit.commit).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.objectContaining({ '--no-verify': null }),
      );
      expect(result).toBe('deadbeef');
    });
  });

  describe('commit message formatting', () => {
    it('should normalize to canonical conventional subject format', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: ['src/foo.ts'],
        files: [{ path: 'src/foo.ts' }],
      });

      await manager.commit('wip: tighten retry handling', 42, 'feat');

      expect(mockGit.commit).toHaveBeenCalledWith(
        'feat(issue-42): wip: tighten retry handling (#42)',
        undefined,
        expect.objectContaining({ '--no-verify': null }),
      );
    });
  });

  describe('push', () => {
    it('should push without force by default', async () => {
      await manager.push(false, 'feature/my-branch');

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const pushCall = rawCalls.find(([args]) => args[0] === 'push');
      expect(pushCall).toBeDefined();
      expect(pushCall![0]).toContain('HEAD:refs/heads/feature/my-branch');
      expect(pushCall![0]).not.toContain('--force-with-lease');
      expect(pushCall![0]).toContain('--set-upstream');
    });

    it('should include --force-with-lease when force is true', async () => {
      await manager.push(true, 'feature/my-branch');

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const pushCall = rawCalls.find(([args]) => args[0] === 'push');
      expect(pushCall![0]).toContain('--force-with-lease');
    });
  });

  describe('squash', () => {
    it('should soft-reset to base and create a single commit', async () => {
      mockGit.commit.mockResolvedValueOnce({ commit: 'squashed123' });

      const result = await manager.squash('base456', 'feat: squashed message');

      expect(mockGit.reset).toHaveBeenCalledWith(['--soft', 'base456']);
      expect(mockGit.commit).toHaveBeenCalledWith(
        'feat: squashed message',
        undefined,
        expect.objectContaining({ '--no-verify': null }),
      );
      expect(result).toBe('squashed123');
    });

    it('should return empty string when commit returns no sha', async () => {
      mockGit.commit.mockResolvedValueOnce({ commit: '' });

      const result = await manager.squash('base456', 'feat: squashed');
      expect(result).toBe('');
    });
  });

  describe('getChangedFiles', () => {
    it('should return all changed files across all status categories', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => false,
        staged: [],
        modified: ['src/a.ts'],
        created: ['src/b.ts'],
        deleted: ['src/c.ts'],
        renamed: [{ from: 'src/d.ts', to: 'src/e.ts' }],
        not_added: ['src/f.ts'],
        files: [],
      });

      const result = await manager.getChangedFiles();

      expect(result).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/e.ts', 'src/f.ts']);
    });

    it('should return empty array when working tree is clean', async () => {
      mockGit.status.mockResolvedValue({
        isClean: () => true,
        staged: [],
        modified: [],
        created: [],
        deleted: [],
        renamed: [],
        not_added: [],
        files: [],
      });

      const result = await manager.getChangedFiles();
      expect(result).toEqual([]);
    });
  });

  describe('isClean', () => {
    it('should return true when working tree is clean', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => true, staged: [], files: [] });
      expect(await manager.isClean()).toBe(true);
    });

    it('should return false when there are uncommitted changes', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => false, staged: ['src/foo.ts'], files: [] });
      expect(await manager.isClean()).toBe(false);
    });
  });

  describe('getDiff', () => {
    it('should call diff with baseCommit range when baseCommit is provided', async () => {
      mockGit.diff.mockResolvedValueOnce('diff output');

      const result = await manager.getDiff('abc123');

      expect(mockGit.diff).toHaveBeenCalledWith(['abc123..HEAD']);
      expect(result).toBe('diff output');
    });

    it('should call diff with no args when baseCommit is not provided', async () => {
      mockGit.diff.mockResolvedValueOnce('unstaged diff');

      const result = await manager.getDiff();

      expect(mockGit.diff).toHaveBeenCalledWith();
      expect(result).toBe('unstaged diff');
    });
  });
});
