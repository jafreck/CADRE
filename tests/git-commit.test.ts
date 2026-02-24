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

      const restoreCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: string[][]) =>
          Array.isArray(args[0]) &&
          args[0][0] === 'restore' &&
          args[0].includes('--staged'),
      );
      expect(restoreCalls.length).toBeGreaterThan(0);

      const restoreArgs: string[] = restoreCalls[0][0];
      expect(restoreArgs).toContain('.cadre/');
      expect(restoreArgs).toContain('task-*.md');
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
      const restoreArgs: string[] = restoreCalls[0][0];

      // Exact file paths — not broad directory patterns
      expect(restoreArgs).toContain('.github/agents/code-writer.agent.md');
      expect(restoreArgs).toContain('.github/agents/codebase-scout.agent.md');
      // Must NOT use broad patterns that would affect the target repo's own agents
      expect(restoreArgs).not.toContain('.github/agents/');
      expect(restoreArgs).not.toContain('.claude/agents/');
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
      const restoreArgs: string[] = restoreCalls[0][0];
      expect(restoreArgs).toContain('.cadre/');
      expect(restoreArgs).toContain('task-*.md');
      // No extra paths beyond the two core patterns + surrounding restore args
      const pathArgs = restoreArgs.slice(restoreArgs.indexOf('--') + 1);
      expect(pathArgs).toEqual(['.cadre/', 'task-*.md']);
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

      const rawCalls = (mockGit.raw as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const stagedRestoreCall = rawCalls.find(
        ([args]) => args.includes('restore') && args.includes('--staged'),
      );
      expect(stagedRestoreCall![0]).toContain('.github/agents/code-writer.agent.md');
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
});
