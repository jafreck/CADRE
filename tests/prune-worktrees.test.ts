import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

// ── Hoisted mock objects (accessible inside vi.mock factories) ─────────────

const mockProvider = vi.hoisted(() => ({
  name: 'github',
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  checkAuth: vi.fn().mockResolvedValue(true),
  getIssue: vi.fn(),
  listIssues: vi.fn().mockResolvedValue([]),
  listPullRequests: vi.fn().mockResolvedValue([]),
  createPullRequest: vi.fn(),
  getPullRequest: vi.fn(),
  updatePullRequest: vi.fn(),
  addIssueComment: vi.fn(),
  issueLinkSuffix: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../src/platform/factory.js', () => ({
  createPlatformProvider: vi.fn().mockReturnValue(mockProvider),
}));

vi.mock('../src/notifications/manager.js', () => ({
  createNotificationManager: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockWorktreeManager = vi.hoisted(() => ({
  listActive: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  provision: vi.fn(),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => mockWorktreeManager),
}));

const mockBranchManager = vi.hoisted(() => ({
  deleteLocal: vi.fn().mockResolvedValue(undefined),
  deleteRemote: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  existsLocal: vi.fn(),
  existsRemote: vi.fn(),
  getHead: vi.fn(),
}));

vi.mock('../src/git/branch.js', () => ({
  BranchManager: vi.fn().mockImplementation(() => mockBranchManager),
}));

const mockCheckpointManager = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue({
    issues: {},
    tokenUsage: { total: 0, byIssue: {} },
    lastCheckpoint: '',
    resumeCount: 0,
    projectName: 'test',
  }),
  pruneIssue: vi.fn().mockResolvedValue(undefined),
  setIssueStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => mockCheckpointManager),
}));

vi.mock('../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: true, issues: [], prsCreated: [], failedIssues: [], totalDuration: 0, tokenUsage: { total: 0, byIssue: {}, byAgent: {} } }),
  })),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({ init: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({ appendEvent: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({ estimate: vi.fn().mockReturnValue(0), format: vi.fn().mockReturnValue('$0.00') })),
}));

vi.mock('../src/budget/token-tracker.js', () => ({ TokenTracker: vi.fn() }));
vi.mock('../src/util/process.js', () => ({ killAllTrackedProcesses: vi.fn() }));

vi.mock('../src/validation/index.js', () => ({
  PreRunValidationSuite: vi.fn().mockImplementation(() => ({ run: vi.fn().mockResolvedValue(true) })),
  gitValidator: vi.fn(),
  agentBackendValidator: vi.fn(),
  platformValidator: vi.fn(),
  commandValidator: vi.fn(),
  diskValidator: vi.fn(),
}));

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: { listReports: vi.fn().mockResolvedValue([]), readReport: vi.fn() },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { CadreRuntime } from '../src/core/runtime.js';
import { createPlatformProvider } from '../src/platform/factory.js';

const MockCreatePlatformProvider = createPlatformProvider as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(cleanup?: Partial<CadreConfig['cleanup']>): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [] },
    commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
    pullRequest: { autoCreate: true, draft: true, labels: [], reviewers: [], linkIssue: true },
    options: {
      maxParallelIssues: 3,
      maxParallelAgents: 3,
      maxRetriesPerTask: 3,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
      skipValidation: true,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4', agentDir: '.github/agents', timeout: 300000, costOverrides: {} },
    notifications: { enabled: false, providers: [] },
    cleanup: {
      deleteRemoteBranch: true,
      onMerged: true,
      onClosed: false,
      ...cleanup,
    },
  } as unknown as CadreConfig;
}

function makeWorktree(issueNumber: number, branch = `cadre/issue-${issueNumber}`) {
  return {
    issueNumber,
    branch,
    path: `/tmp/worktrees/issue-${issueNumber}`,
    exists: true,
    baseCommit: 'abc123',
  };
}

function makePR(overrides: Partial<{ number: number; state: string; merged: boolean; headBranch: string }> = {}) {
  return {
    number: 42,
    url: 'https://github.com/owner/repo/pulls/42',
    title: 'Test PR',
    headBranch: 'cadre/issue-1',
    baseBranch: 'main',
    state: 'merged',
    merged: true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CadreRuntime.pruneWorktrees() — PR-aware cleanup', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    // Reset mock implementations to clean defaults
    mockWorktreeManager.listActive.mockResolvedValue([]);
    mockWorktreeManager.remove.mockResolvedValue(undefined);
    mockBranchManager.deleteLocal.mockResolvedValue(undefined);
    mockBranchManager.deleteRemote.mockResolvedValue(undefined);
    mockCheckpointManager.pruneIssue.mockResolvedValue(undefined);
    mockProvider.connect.mockResolvedValue(undefined);
    mockProvider.disconnect.mockResolvedValue(undefined);
    mockProvider.listPullRequests.mockResolvedValue([]);

    MockCreatePlatformProvider.mockReturnValue(mockProvider);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  describe('provider lifecycle', () => {
    it('connects to the platform provider before querying PRs', async () => {
      const config = makeConfig();
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockProvider.connect).toHaveBeenCalledOnce();
    });

    it('disconnects from the platform provider after the run', async () => {
      const config = makeConfig();
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockProvider.disconnect).toHaveBeenCalledOnce();
    });

    it('disconnects even when no worktrees are active', async () => {
      mockWorktreeManager.listActive.mockResolvedValue([]);
      const config = makeConfig();
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockProvider.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('merged PR cleanup', () => {
    it('removes the worktree when the PR is merged and onMerged is true', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(1);
    });

    it('deletes the local branch when the PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockBranchManager.deleteLocal).toHaveBeenCalledWith(wt.branch);
    });

    it('deletes the remote branch when deleteRemoteBranch is true and PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockBranchManager.deleteRemote).toHaveBeenCalledWith(wt.branch);
    });

    it('does not delete the remote branch when deleteRemoteBranch is false', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockBranchManager.deleteRemote).not.toHaveBeenCalled();
    });

    it('prunes the fleet checkpoint entry when the PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).toHaveBeenCalledWith(1);
    });

    it('does not remove worktree when onMerged is false even if PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });
  });

  describe('closed (not merged) PR cleanup', () => {
    it('removes the worktree when the PR is closed and onClosed is true', async () => {
      const wt = makeWorktree(2);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(2);
    });

    it('prunes checkpoint when PR is closed and onClosed is true', async () => {
      const wt = makeWorktree(2);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).toHaveBeenCalledWith(2);
    });

    it('does not remove worktree when PR is closed and onClosed is false', async () => {
      const wt = makeWorktree(2);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });

    it('does not remove worktree when PR is open', async () => {
      const wt = makeWorktree(3);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'open', merged: false })]);

      const config = makeConfig({ onMerged: true, onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });
  });

  describe('worktrees with no associated PR', () => {
    it('skips worktrees that have no matching PR without error', async () => {
      const wt = makeWorktree(5);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);

      await expect(runtime.pruneWorktrees()).resolves.not.toThrow();
      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });

    it('queries provider with the branch name of each worktree', async () => {
      const wt = makeWorktree(7, 'cadre/issue-7');
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([]);

      const config = makeConfig();
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockProvider.listPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({ head: 'cadre/issue-7' }),
      );
    });
  });

  describe('dry-run mode', () => {
    it('does not remove any worktree in dry-run mode', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });

    it('does not delete local branch in dry-run mode', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockBranchManager.deleteLocal).not.toHaveBeenCalled();
    });

    it('does not delete remote branch in dry-run mode', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockBranchManager.deleteRemote).not.toHaveBeenCalled();
    });

    it('does not prune checkpoint in dry-run mode', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });

    it('still connects and disconnects the provider in dry-run mode', async () => {
      const config = makeConfig();
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockProvider.connect).toHaveBeenCalledOnce();
      expect(mockProvider.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('multiple worktrees', () => {
    it('processes all worktrees and prunes each one that qualifies', async () => {
      const wt1 = makeWorktree(10, 'cadre/issue-10');
      const wt2 = makeWorktree(11, 'cadre/issue-11');
      const wt3 = makeWorktree(12, 'cadre/issue-12');

      mockWorktreeManager.listActive.mockResolvedValue([wt1, wt2, wt3]);
      mockProvider.listPullRequests
        .mockResolvedValueOnce([makePR({ headBranch: wt1.branch, state: 'merged', merged: true })])
        .mockResolvedValueOnce([])  // no PR for issue 11
        .mockResolvedValueOnce([makePR({ headBranch: wt3.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onMerged: true, onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(10);
      expect(mockWorktreeManager.remove).not.toHaveBeenCalledWith(11);
      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(12);
      expect(mockCheckpointManager.pruneIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe('no cleanup config', () => {
    it('does not error when cleanup config is absent', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = { ...makeConfig(), cleanup: undefined } as unknown as CadreConfig;
      const runtime = new CadreRuntime(config);

      await expect(runtime.pruneWorktrees()).resolves.not.toThrow();
    });
  });
});
