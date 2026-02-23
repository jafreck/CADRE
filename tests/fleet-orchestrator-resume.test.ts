import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { TokenRecord } from '../src/budget/token-tracker.js';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockImportRecords,
  mockFleetCheckpointGetState,
} = vi.hoisted(() => ({
  mockImportRecords: vi.fn(),
  mockFleetCheckpointGetState: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn().mockImplementation(() => ({
    importRecords: mockImportRecords,
    record: vi.fn(),
    getTotal: vi.fn().mockReturnValue(0),
    checkFleetBudget: vi.fn().mockReturnValue('ok'),
    getSummary: vi.fn().mockReturnValue({
      total: 0,
      byIssue: {},
      byAgent: {},
      byPhase: {},
      recordCount: 0,
    }),
  })),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({}),
    setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
  })),
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    getState: mockFleetCheckpointGetState,
    isIssueCompleted: vi.fn().mockReturnValue(false),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    getIssueStatus: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../src/core/issue-orchestrator.js', () => ({
  IssueOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: true,
      phases: [],
      totalDuration: 100,
      tokenUsage: 500,
    }),
  })),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    write: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
  IssueProgressWriter: vi.fn(),
}));

vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn().mockReturnValue(5),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn(),
}));

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: vi.fn().mockImplementation(() => ({
    buildReport: vi.fn().mockReturnValue({}),
    write: vi.fn().mockResolvedValue('/tmp/report.md'),
  })),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/notifications/manager.js', () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<CadreConfig['options']> = {}): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [1] },
    commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
    pullRequest: { autoCreate: false, draft: true, labels: [], reviewers: [], linkIssue: false },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
      ...overrides,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4', agentDir: '.github/agents', timeout: 300000 },
  } as unknown as CadreConfig;
}

function makeIssue(number = 1): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
  } as unknown as IssueDetail;
}

function makeDeps() {
  return {
    worktreeManager: {
      provision: vi.fn().mockResolvedValue({
        path: '/tmp/worktree/1',
        branch: 'cadre/issue-1',
        baseCommit: 'abc123',
      }),
    },
    launcher: {},
    platform: {},
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  };
}

function makeFleetState(records: TokenRecord[]) {
  return {
    projectName: 'test-project',
    version: 1,
    issues: {},
    tokenUsage: { total: 0, byIssue: {}, records },
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 1,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FleetOrchestrator — TokenTracker importRecords on resume (task-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls tokenTracker.importRecords() with persisted records when resume is true', async () => {
    const persistedRecords: TokenRecord[] = [
      { issueNumber: 1, agent: 'issue-analyst', phase: 1, tokens: 200, timestamp: '2024-01-01T00:00:00Z' },
      { issueNumber: 1, agent: 'codebase-scout', phase: 1, tokens: 150, timestamp: '2024-01-01T00:01:00Z' },
    ];
    mockFleetCheckpointGetState.mockReturnValue(makeFleetState(persistedRecords));

    const config = makeConfig({ resume: true });
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config,
      [makeIssue(1)],
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(mockImportRecords).toHaveBeenCalledOnce();
    expect(mockImportRecords).toHaveBeenCalledWith(persistedRecords);
  });

  it('calls tokenTracker.importRecords() with an empty array when records is undefined in the checkpoint', async () => {
    // Simulate an older checkpoint state where records field may be absent
    const stateWithUndefinedRecords = {
      ...makeFleetState([]),
      tokenUsage: { total: 0, byIssue: {}, records: undefined as any },
    };
    mockFleetCheckpointGetState.mockReturnValue(stateWithUndefinedRecords);

    const config = makeConfig({ resume: true });
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config,
      [makeIssue(1)],
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(mockImportRecords).toHaveBeenCalledOnce();
    expect(mockImportRecords).toHaveBeenCalledWith([]);
  });

  it('calls tokenTracker.importRecords() with an empty array when records is empty in the checkpoint', async () => {
    mockFleetCheckpointGetState.mockReturnValue(makeFleetState([]));

    const config = makeConfig({ resume: true });
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config,
      [makeIssue(1)],
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(mockImportRecords).toHaveBeenCalledOnce();
    expect(mockImportRecords).toHaveBeenCalledWith([]);
  });

  it('does NOT call tokenTracker.importRecords() on a fresh run (resume: false)', async () => {
    const config = makeConfig({ resume: false });
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config,
      [makeIssue(1)],
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(mockImportRecords).not.toHaveBeenCalled();
    // getState should not be called either since we short-circuit on resume flag
    expect(mockFleetCheckpointGetState).not.toHaveBeenCalled();
  });

  it('importRecords is called after fleetCheckpoint.load() completes', async () => {
    const callOrder: string[] = [];

    const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
    (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      load: vi.fn().mockImplementation(async () => { callOrder.push('load'); }),
      getState: vi.fn().mockImplementation(() => {
        callOrder.push('getState');
        return makeFleetState([]);
      }),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    mockImportRecords.mockImplementation(() => { callOrder.push('importRecords'); });

    const config = makeConfig({ resume: true });
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config,
      [makeIssue(1)],
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(callOrder.indexOf('load')).toBeLessThan(callOrder.indexOf('importRecords'));
    expect(callOrder.indexOf('getState')).toBeLessThan(callOrder.indexOf('importRecords'));
  });
});
