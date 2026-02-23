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

const mockWorktreeManager = vi.hoisted(() => ({
  listActive: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  provision: vi.fn(),
}));

const mockBranchManager = vi.hoisted(() => ({
  deleteLocal: vi.fn().mockResolvedValue(undefined),
  deleteRemote: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  existsLocal: vi.fn(),
  existsRemote: vi.fn(),
  getHead: vi.fn(),
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

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => mockWorktreeManager),
}));

vi.mock('../src/git/branch.js', () => ({
  BranchManager: vi.fn().mockImplementation(() => mockBranchManager),
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

describe('CadreRuntime.pruneWorktrees() — cleanup logic', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    mockWorktreeManager.listActive.mockResolvedValue([]);
    mockWorktreeManager.remove.mockResolvedValue(undefined);
    mockBranchManager.deleteLocal.mockResolvedValue(undefined);
    mockBranchManager.deleteRemote.mockResolvedValue(undefined);
    mockCheckpointManager.pruneIssue.mockResolvedValue(undefined);
    mockProvider.connect.mockResolvedValue(undefined);
    mockProvider.disconnect.mockResolvedValue(undefined);
    mockProvider.listPullRequests.mockResolvedValue([]);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  // Scenario 1: merged PR triggers worktree + branch + remote-branch removal when deleteRemoteBranch is true
  describe('scenario 1: merged PR — full cleanup when deleteRemoteBranch is true', () => {
    it('removes the worktree when the PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(1);
    });

    it('deletes the local branch when the PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
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

    it('prunes the checkpoint entry when the PR is merged', async () => {
      const wt = makeWorktree(1);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).toHaveBeenCalledWith(1);
    });
  });

  // Scenario 2: closed PR is skipped when onClosed is false
  describe('scenario 2: closed PR — skipped when onClosed is false', () => {
    it('does not remove the worktree when PR is closed and onClosed is false', async () => {
      const wt = makeWorktree(2);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });

    it('does not prune checkpoint when PR is closed and onClosed is false', async () => {
      const wt = makeWorktree(2);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });
  });

  // Scenario 3: closed PR triggers cleanup when onClosed is true
  describe('scenario 3: closed PR — triggers cleanup when onClosed is true', () => {
    it('removes the worktree when the PR is closed and onClosed is true', async () => {
      const wt = makeWorktree(3);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(3);
    });

    it('prunes the checkpoint when PR is closed and onClosed is true', async () => {
      const wt = makeWorktree(3);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'closed', merged: false })]);

      const config = makeConfig({ onClosed: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).toHaveBeenCalledWith(3);
    });
  });

  // Scenario 4: dry-run mode skips destructive actions
  describe('scenario 4: dry-run mode — skips all destructive actions', () => {
    it('does not remove any worktree in dry-run mode', async () => {
      const wt = makeWorktree(4);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });

    it('does not delete local branch in dry-run mode', async () => {
      const wt = makeWorktree(4);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockBranchManager.deleteLocal).not.toHaveBeenCalled();
    });

    it('does not delete remote branch in dry-run mode', async () => {
      const wt = makeWorktree(4);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockBranchManager.deleteRemote).not.toHaveBeenCalled();
    });

    it('does not prune checkpoint in dry-run mode', async () => {
      const wt = makeWorktree(4);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees(true);

      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });
  });

  // Scenario 5: worktree with no associated PR is skipped
  describe('scenario 5: worktree with no associated PR — skipped', () => {
    it('skips worktrees that have no matching PR without error', async () => {
      const wt = makeWorktree(5);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);

      await expect(runtime.pruneWorktrees()).resolves.not.toThrow();
      expect(mockWorktreeManager.remove).not.toHaveBeenCalled();
    });

    it('does not prune checkpoint for worktrees with no matching PR', async () => {
      const wt = makeWorktree(5);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([]);

      const config = makeConfig({ onMerged: true });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockCheckpointManager.pruneIssue).not.toHaveBeenCalled();
    });
  });

  // Scenario 6: remote branch deletion is skipped when deleteRemoteBranch is false
  describe('scenario 6: remote branch deletion — skipped when deleteRemoteBranch is false', () => {
    it('does not delete remote branch when deleteRemoteBranch is false', async () => {
      const wt = makeWorktree(6);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockBranchManager.deleteRemote).not.toHaveBeenCalled();
    });

    it('still removes the worktree and local branch when deleteRemoteBranch is false', async () => {
      const wt = makeWorktree(6);
      mockWorktreeManager.listActive.mockResolvedValue([wt]);
      mockProvider.listPullRequests.mockResolvedValue([makePR({ headBranch: wt.branch, state: 'merged', merged: true })]);

      const config = makeConfig({ onMerged: true, deleteRemoteBranch: false });
      const runtime = new CadreRuntime(config);
      await runtime.pruneWorktrees();

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(6);
      expect(mockBranchManager.deleteLocal).toHaveBeenCalledWith(wt.branch);
    });
  });
});
