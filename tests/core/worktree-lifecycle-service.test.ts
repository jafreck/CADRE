import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockListActive = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    listActive: mockListActive,
    remove: mockRemove,
  })),
}));

vi.mock('../../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      projectName: 'test-project',
      issues: {},
      tokenUsage: { total: 0, byIssue: {} },
      lastCheckpoint: '',
      resumeCount: 0,
    }),
  })),
}));

import { WorktreeLifecycleService } from '../../src/core/worktree-lifecycle-service.js';
import { FleetCheckpointManager } from '../../src/core/checkpoint.js';
import type { RuntimeConfig } from '../../src/config/loader.js';

const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;

function makeConfig(): RuntimeConfig {
  return {
    stateDir: '/tmp/cadre-state',
    projectName: 'test-project',
    repoPath: '/tmp/repo',
    worktreeRoot: '/tmp/worktrees',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    agent: {
      backend: 'copilot',
      copilot: { cliCommand: 'copilot', agentDir: '/tmp/.cadre/agents' },
      claude: { cliCommand: 'claude', agentDir: '/tmp/.cadre/agents' },
    },
  } as unknown as RuntimeConfig;
}

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listPullRequests: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

describe('WorktreeLifecycleService', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('listWorktrees()', () => {
    it('should print "No active worktrees" when none exist', async () => {
      mockListActive.mockResolvedValue([]);

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), makeProvider());
      await service.listWorktrees();

      expect(consoleSpy).toHaveBeenCalledWith('  No active worktrees');
    });

    it('should print the header', async () => {
      mockListActive.mockResolvedValue([]);

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), makeProvider());
      await service.listWorktrees();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Active CADRE Worktrees'));
    });

    it('should list each worktree with issue number, path, branch, and base commit', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 1, path: '/tmp/wt/1', branch: 'cadre/issue-1', baseCommit: 'abcdef12' },
        { issueNumber: 2, path: '/tmp/wt/2', branch: 'cadre/issue-2', baseCommit: '12345678' },
      ]);

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), makeProvider());
      await service.listWorktrees();

      expect(consoleSpy).toHaveBeenCalledWith('  Issue #1');
      expect(consoleSpy).toHaveBeenCalledWith('    Path: /tmp/wt/1');
      expect(consoleSpy).toHaveBeenCalledWith('    Branch: cadre/issue-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('abcdef12'));
      expect(consoleSpy).toHaveBeenCalledWith('  Issue #2');
    });
  });

  describe('pruneWorktrees()', () => {
    it('should connect and disconnect the provider', async () => {
      mockListActive.mockResolvedValue([]);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({ issues: {} }),
      }));
      const provider = makeProvider();

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await service.pruneWorktrees();

      expect(provider.connect).toHaveBeenCalledOnce();
      expect(provider.disconnect).toHaveBeenCalledOnce();
    });

    it('should prune worktrees for locally completed issues', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 1, path: '/tmp/wt/1', branch: 'cadre/issue-1', baseCommit: 'abc123' },
      ]);
      mockRemove.mockResolvedValue(undefined);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 1: { status: 'completed' } },
        }),
      }));

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), makeProvider());
      await service.pruneWorktrees();

      expect(mockRemove).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pruned: issue #1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('locally completed'));
    });

    it('should prune worktrees when PR is closed on platform', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 5, path: '/tmp/wt/5', branch: 'cadre/issue-5', baseCommit: 'abc123' },
      ]);
      mockRemove.mockResolvedValue(undefined);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 5: { status: 'in-progress' } },
        }),
      }));
      const provider = makeProvider({
        listPullRequests: vi.fn().mockResolvedValue([
          { headBranch: 'cadre/issue-5', state: 'closed' },
        ]),
      });

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await service.pruneWorktrees();

      expect(mockRemove).toHaveBeenCalledWith(5);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PR closed/merged'));
    });

    it('should prune worktrees when PR is merged on platform', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 6, path: '/tmp/wt/6', branch: 'cadre/issue-6', baseCommit: 'abc123' },
      ]);
      mockRemove.mockResolvedValue(undefined);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 6: { status: 'in-progress' } },
        }),
      }));
      const provider = makeProvider({
        listPullRequests: vi.fn().mockResolvedValue([
          { headBranch: 'cadre/issue-6', state: 'merged' },
        ]),
      });

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await service.pruneWorktrees();

      expect(mockRemove).toHaveBeenCalledWith(6);
    });

    it('should skip worktrees with open PRs and not-completed status', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 3, path: '/tmp/wt/3', branch: 'cadre/issue-3', baseCommit: 'abc123' },
      ]);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 3: { status: 'in-progress' } },
        }),
      }));
      const provider = makeProvider({
        listPullRequests: vi.fn().mockResolvedValue([
          { headBranch: 'cadre/issue-3', state: 'open' },
        ]),
      });

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await service.pruneWorktrees();

      expect(mockRemove).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped: issue #3'));
    });

    it('should handle PR fetch errors gracefully and skip the worktree', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 4, path: '/tmp/wt/4', branch: 'cadre/issue-4', baseCommit: 'abc123' },
      ]);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 4: { status: 'in-progress' } },
        }),
      }));
      const logger = makeLogger();
      const provider = makeProvider({
        listPullRequests: vi.fn().mockRejectedValue(new Error('API error')),
      });

      const service = new WorktreeLifecycleService(makeConfig(), logger, provider);
      await service.pruneWorktrees();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch PR state for issue #4'),
        expect.any(Object),
      );
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('should print the total number of pruned worktrees', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 1, path: '/tmp/wt/1', branch: 'cadre/issue-1', baseCommit: 'abc' },
        { issueNumber: 2, path: '/tmp/wt/2', branch: 'cadre/issue-2', baseCommit: 'def' },
      ]);
      mockRemove.mockResolvedValue(undefined);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: {
            1: { status: 'completed' },
            2: { status: 'completed' },
          },
        }),
      }));

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), makeProvider());
      await service.pruneWorktrees();

      expect(consoleSpy).toHaveBeenCalledWith('\nPruned 2 worktrees');
    });

    it('should disconnect provider even if an error occurs during pruning', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 1, path: '/tmp/wt/1', branch: 'cadre/issue-1', baseCommit: 'abc' },
      ]);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 1: { status: 'completed' } },
        }),
      }));
      mockRemove.mockRejectedValue(new Error('Remove failed'));
      const provider = makeProvider();

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await expect(service.pruneWorktrees()).rejects.toThrow('Remove failed');

      expect(provider.disconnect).toHaveBeenCalledOnce();
    });

    it('should show both reasons when locally completed and PR closed', async () => {
      mockListActive.mockResolvedValue([
        { issueNumber: 10, path: '/tmp/wt/10', branch: 'cadre/issue-10', baseCommit: 'abc' },
      ]);
      mockRemove.mockResolvedValue(undefined);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          issues: { 10: { status: 'completed' } },
        }),
      }));
      const provider = makeProvider({
        listPullRequests: vi.fn().mockResolvedValue([
          { headBranch: 'cadre/issue-10', state: 'merged' },
        ]),
      });

      const service = new WorktreeLifecycleService(makeConfig(), makeLogger(), provider);
      await service.pruneWorktrees();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('locally completed'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PR closed/merged'));
    });
  });
});
