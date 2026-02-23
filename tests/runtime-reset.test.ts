import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

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
  createPlatformProvider: vi.fn().mockReturnValue({
    name: 'github',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkAuth: vi.fn().mockResolvedValue(true),
    listIssues: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../src/notifications/manager.js', () => ({
  createNotificationManager: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn(),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue(0),
    format: vi.fn().mockReturnValue('$0.00'),
  })),
}));

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn(),
}));

vi.mock('../src/util/process.js', () => ({
  killAllTrackedProcesses: vi.fn(),
}));

// CheckpointManager mock – overridden per-test for the per-issue instance
const mockResetFromPhase = vi.fn().mockResolvedValue(undefined);
const mockIssueCheckpointLoad = vi.fn().mockResolvedValue(undefined);

const MockCheckpointManager = vi.fn().mockImplementation(() => ({
  load: mockIssueCheckpointLoad,
  resetFromPhase: mockResetFromPhase,
}));

// FleetCheckpointManager mock – state is adjusted per-test
const mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
const mockFleetLoad = vi.fn();

const MockFleetCheckpointManager = vi.fn().mockImplementation(() => ({
  load: mockFleetLoad,
  setIssueStatus: mockSetIssueStatus,
}));

vi.mock('../src/core/checkpoint.js', () => ({
  get CheckpointManager() {
    return MockCheckpointManager;
  },
  get FleetCheckpointManager() {
    return MockFleetCheckpointManager;
  },
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

import { CadreRuntime } from '../src/core/runtime.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(): CadreConfig {
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
  } as unknown as CadreConfig;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CadreRuntime.reset()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueCheckpointLoad.mockResolvedValue(undefined);
    mockResetFromPhase.mockResolvedValue(undefined);
    mockSetIssueStatus.mockResolvedValue(undefined);
  });

  describe('reset(issueNumber) — without fromPhase', () => {
    it('calls setIssueStatus with phase 0 when fromPhase is not provided', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '/wt/42', branchName: 'cadre/issue-42', lastPhase: 2 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42);

      expect(mockSetIssueStatus).toHaveBeenCalledOnce();
      expect(mockSetIssueStatus).toHaveBeenCalledWith(42, 'not-started', '/wt/42', 'cadre/issue-42', 0);
    });

    it('does not instantiate CheckpointManager when fromPhase is not provided', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '/wt/42', branchName: 'cadre/issue-42', lastPhase: 2 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42);

      expect(MockCheckpointManager).not.toHaveBeenCalled();
      expect(mockResetFromPhase).not.toHaveBeenCalled();
    });
  });

  describe('reset(issueNumber, fromPhase) — with fromPhase', () => {
    it('calls CheckpointManager.resetFromPhase with the given phase when issue has a worktreePath', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '/wt/42', branchName: 'cadre/issue-42', lastPhase: 3 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42, 2);

      expect(MockCheckpointManager).toHaveBeenCalledOnce();
      expect(mockIssueCheckpointLoad).toHaveBeenCalledWith('42');
      expect(mockResetFromPhase).toHaveBeenCalledWith(2);
    });

    it('instantiates CheckpointManager with the correct progressDir', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '/wt/42', branchName: 'cadre/issue-42', lastPhase: 3 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42, 2);

      expect(MockCheckpointManager).toHaveBeenCalledWith(
        '/wt/42/.cadre/issues/42',
        expect.anything(),
      );
    });

    it('calls setIssueStatus with the provided fromPhase (not 0)', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '/wt/42', branchName: 'cadre/issue-42', lastPhase: 3 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42, 3);

      expect(mockSetIssueStatus).toHaveBeenCalledWith(42, 'not-started', '/wt/42', 'cadre/issue-42', 3);
    });

    it('skips CheckpointManager when issue has no worktreePath', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          42: { status: 'in-progress', worktreePath: '', branchName: '', lastPhase: 2 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(42, 2);

      expect(MockCheckpointManager).not.toHaveBeenCalled();
      expect(mockResetFromPhase).not.toHaveBeenCalled();
      // setIssueStatus should still be called
      expect(mockSetIssueStatus).toHaveBeenCalledWith(42, 'not-started', '', '', 2);
    });

    it('skips CheckpointManager when issue is not in fleet state', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {},
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(99, 1);

      expect(MockCheckpointManager).not.toHaveBeenCalled();
      expect(mockSetIssueStatus).toHaveBeenCalledWith(99, 'not-started', '', '', 1);
    });
  });

  describe('reset() — fleet-wide reset (no issueNumber)', () => {
    it('calls setIssueStatus for every issue in fleet state with phase 0', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          1: { status: 'completed', worktreePath: '/wt/1', branchName: 'b1', lastPhase: 5 },
          2: { status: 'failed', worktreePath: '/wt/2', branchName: 'b2', lastPhase: 3 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset();

      expect(mockSetIssueStatus).toHaveBeenCalledTimes(2);
      expect(mockSetIssueStatus).toHaveBeenCalledWith(1, 'not-started', '', '', 0);
      expect(mockSetIssueStatus).toHaveBeenCalledWith(2, 'not-started', '', '', 0);
    });

    it('does not call CheckpointManager for fleet-wide reset when fromPhase is absent', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          1: { status: 'completed', worktreePath: '/wt/1', branchName: 'b1', lastPhase: 5 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset();

      expect(MockCheckpointManager).not.toHaveBeenCalled();
    });

    it('calls CheckpointManager.resetFromPhase for each issue when fromPhase is provided in fleet-wide reset', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          1: { status: 'in-progress', worktreePath: '/wt/1', branchName: 'b1', lastPhase: 3 },
          2: { status: 'in-progress', worktreePath: '/wt/2', branchName: 'b2', lastPhase: 4 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(undefined, 2);

      expect(MockCheckpointManager).toHaveBeenCalledTimes(2);
      expect(mockResetFromPhase).toHaveBeenCalledTimes(2);
      expect(mockResetFromPhase).toHaveBeenCalledWith(2);
    });

    it('calls setIssueStatus with fromPhase for each issue in fleet-wide reset', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {
          10: { status: 'in-progress', worktreePath: '/wt/10', branchName: 'b10', lastPhase: 3 },
          20: { status: 'completed', worktreePath: '/wt/20', branchName: 'b20', lastPhase: 5 },
        },
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset(undefined, 3);

      expect(mockSetIssueStatus).toHaveBeenCalledWith(10, 'not-started', '', '', 3);
      expect(mockSetIssueStatus).toHaveBeenCalledWith(20, 'not-started', '', '', 3);
    });

    it('does nothing when fleet has no issues', async () => {
      mockFleetLoad.mockResolvedValue({
        issues: {},
        tokenUsage: { total: 0 },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
      });

      const runtime = new CadreRuntime(makeConfig());
      await runtime.reset();

      expect(mockSetIssueStatus).not.toHaveBeenCalled();
      expect(MockCheckpointManager).not.toHaveBeenCalled();
    });
  });
});
