import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

// Mock heavy dependencies
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
    getIssue: vi.fn().mockResolvedValue({ number: 1, title: 'Test', body: '', labels: [], state: 'open', url: '', author: 'u', createdAt: '', updatedAt: '', comments: [] }),
    listIssues: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../src/notifications/manager.js', () => ({
  NotificationManager: vi.fn(),
  createNotificationManager: vi.fn().mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: true, issues: [], prsCreated: [], failedIssues: [], totalDuration: 0, tokenUsage: { total: 0, byIssue: {}, byAgent: {} } }),
  })),
}));

vi.mock('../src/git/worktree.js', () => ({ WorktreeManager: vi.fn() }));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({ init: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../src/util/process.js', () => ({ killAllTrackedProcesses: vi.fn() }));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue({ totalCost: 0 }),
    format: vi.fn().mockReturnValue('$0.00'),
  })),
}));

vi.mock('../src/budget/token-tracker.js', () => ({ TokenTracker: vi.fn() }));

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: { listReports: vi.fn().mockResolvedValue([]), readReport: vi.fn() },
}));

// Mocks under test for status()
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn(),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      projectName: 'test-project',
      issues: {},
      tokenUsage: { total: 0, byIssue: {} },
      lastCheckpoint: '',
      resumeCount: 0,
    }),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
  })),
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      issueNumber: 1,
      version: 1,
      currentPhase: 2,
      currentTask: null,
      completedPhases: [1],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 500, byPhase: { 1: 500 }, byAgent: {} },
      worktreePath: '/tmp/worktrees/issue-1',
      branchName: 'cadre/issue-1',
      baseCommit: 'abc123',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 1,
    }),
  })),
}));

vi.mock('../src/cli/status-renderer.js', () => ({
  renderFleetStatus: vi.fn().mockReturnValue('fleet status table'),
  renderIssueDetail: vi.fn().mockReturnValue('issue detail table'),
}));

import { CadreRuntime } from '../src/core/runtime.js';
import { FleetCheckpointManager, CheckpointManager } from '../src/core/checkpoint.js';
import { exists } from '../src/util/fs.js';
import { renderFleetStatus, renderIssueDetail } from '../src/cli/status-renderer.js';

const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;
const MockCheckpointManager = CheckpointManager as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as ReturnType<typeof vi.fn>;
const mockRenderFleetStatus = renderFleetStatus as ReturnType<typeof vi.fn>;
const mockRenderIssueDetail = renderIssueDetail as ReturnType<typeof vi.fn>;

function makeConfig(): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [1] },
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

describe('CadreRuntime.status() — no fleet checkpoint', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockExists.mockResolvedValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints friendly message and returns when fleet checkpoint does not exist', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(consoleSpy).toHaveBeenCalledWith('No fleet checkpoint found.');
    expect(MockFleetCheckpointManager).not.toHaveBeenCalled();
  });

  it('does not call renderFleetStatus when fleet checkpoint is missing', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — fleet checkpoint exists, no issue filter', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const fleetState = {
    projectName: 'test-project',
    issues: {
      42: { status: 'completed', issueTitle: 'Fix bug', worktreePath: '', branchName: 'cadre/issue-42', lastPhase: 5, updatedAt: new Date().toISOString() },
    },
    tokenUsage: { total: 1000, byIssue: { 42: 1000 } },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Fleet checkpoint exists; issue checkpoint does not matter for no-issue-filter case
    mockExists.mockResolvedValue(true);

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    mockRenderFleetStatus.mockReturnValue('fleet status table');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('loads the fleet checkpoint and renders the fleet status table', async () => {
    const config = makeConfig();
    const runtime = new CadreRuntime(config);
    await runtime.status();

    expect(MockFleetCheckpointManager).toHaveBeenCalledOnce();
    expect(mockRenderFleetStatus).toHaveBeenCalledWith(fleetState, config.copilot.model, config.copilot);
  });

  it('prints the rendered fleet status table to console', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('fleet status table'));
  });

  it('does not render issue detail when no issueNumber is provided', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    expect(MockCheckpointManager).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — with issueNumber, issue present in fleet', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const issueStatus = {
    status: 'in-progress' as const,
    issueTitle: 'Add feature',
    worktreePath: '/tmp/worktrees/issue-7',
    branchName: 'cadre/issue-7',
    lastPhase: 2,
    updatedAt: new Date().toISOString(),
  };

  const fleetState = {
    projectName: 'test-project',
    issues: { 7: issueStatus },
    tokenUsage: { total: 500, byIssue: { 7: 500 } },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 1,
  };

  const issueCheckpointState = {
    issueNumber: 7,
    version: 1,
    currentPhase: 2,
    currentTask: null,
    completedPhases: [1],
    completedTasks: [],
    failedTasks: [],
    blockedTasks: [],
    phaseOutputs: {},
    gateResults: {},
    tokenUsage: { total: 500, byPhase: { 1: 500 }, byAgent: {} },
    worktreePath: '/tmp/worktrees/issue-7',
    branchName: 'cadre/issue-7',
    baseCommit: 'abc123',
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Both fleet and issue checkpoints exist
    mockExists.mockResolvedValue(true);

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    MockCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(issueCheckpointState),
    }));

    mockRenderFleetStatus.mockReturnValue('fleet status table');
    mockRenderIssueDetail.mockReturnValue('issue detail table');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('loads the per-issue checkpoint from the correct directory', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(MockCheckpointManager).toHaveBeenCalledOnce();
    const [progressDir] = MockCheckpointManager.mock.calls[0];
    expect(progressDir).toMatch(/issues[/\\]7$/);
  });

  it('calls renderIssueDetail with correct arguments', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(mockRenderIssueDetail).toHaveBeenCalledWith(7, issueStatus, issueCheckpointState);
  });

  it('prints the rendered issue detail to console', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('issue detail table'));
  });

  it('does not render the fleet status table when issueNumber is provided', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
    expect(mockRenderIssueDetail).toHaveBeenCalledOnce();
  });
});

describe('CadreRuntime.status() — with issueNumber, issue NOT in fleet checkpoint', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const fleetState = {
    projectName: 'test-project',
    issues: {},
    tokenUsage: { total: 0, byIssue: {} },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockExists.mockResolvedValue(true);

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints "Issue #n not found in fleet checkpoint" message', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(99);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Issue #99 not found in fleet checkpoint'));
  });

  it('does not attempt to load per-issue checkpoint', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(99);

    expect(MockCheckpointManager).not.toHaveBeenCalled();
    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — with issueNumber, per-issue checkpoint missing', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const issueStatus = {
    status: 'in-progress' as const,
    issueTitle: 'My issue',
    worktreePath: '',
    branchName: 'cadre/issue-5',
    lastPhase: 1,
    updatedAt: new Date().toISOString(),
  };

  const fleetState = {
    projectName: 'test-project',
    issues: { 5: issueStatus },
    tokenUsage: { total: 0, byIssue: {} },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Fleet checkpoint exists; per-issue checkpoint does not
    mockExists
      .mockResolvedValueOnce(true)  // fleet-checkpoint.json exists
      .mockResolvedValueOnce(false); // per-issue checkpoint.json does not exist

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints "No per-issue checkpoint found for #n" message', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No per-issue checkpoint found for issue #5'));
  });

  it('does not call renderIssueDetail when per-issue checkpoint is missing', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    expect(MockCheckpointManager).not.toHaveBeenCalled();
  });

  it('does not render the fleet status table when per-issue checkpoint is missing', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
  });
});
