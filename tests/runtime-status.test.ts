import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

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

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
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
      currentPhase: 1,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
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

function makeConfig() {
  return makeRuntimeConfig({
    stateDir: '/tmp/cadre-state',
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
      perTaskBuildCheck: true,
      maxBuildFixRounds: 2,
      skipValidation: true,
      maxIntegrationFixRounds: 1,
      ambiguityThreshold: 5,
      haltOnAmbiguity: false,
      respondToReviews: false,
    },
  });
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

  it('prints "No fleet checkpoint found." and returns without loading checkpoint', async () => {
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

  it('returns without printing fleet status even when issueNumber is provided', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(42);

    expect(consoleSpy).toHaveBeenCalledWith('No fleet checkpoint found.');
    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — fleet checkpoint exists, no issue filter', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const fleetState = {
    projectName: 'test-project',
    issues: {
      42: {
        status: 'completed' as const,
        issueTitle: 'Fix bug',
        worktreePath: '',
        branchName: 'cadre/issue-42',
        lastPhase: 5,
        updatedAt: new Date().toISOString(),
      },
    },
    tokenUsage: { total: 1000, byIssue: { 42: 1000 } },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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

  it('calls renderFleetStatus with the loaded fleet state and copilot config', async () => {
    const config = makeConfig();
    const runtime = new CadreRuntime(config);
    await runtime.status();

    expect(mockRenderFleetStatus).toHaveBeenCalledWith(fleetState, config.copilot.model, config.copilot);
  });

  it('prints the rendered fleet status table', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(consoleSpy).toHaveBeenCalledWith('fleet status table');
  });

  it('does not render issue detail when no issueNumber is provided', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    expect(MockCheckpointManager).not.toHaveBeenCalled();
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

  it('prints "Issue #n not found in fleet checkpoint." message', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(99);

    expect(consoleSpy).toHaveBeenCalledWith('Issue #99 not found in fleet checkpoint.');
  });

  it('does not attempt to load per-issue checkpoint or render issue detail', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(99);

    expect(MockCheckpointManager).not.toHaveBeenCalled();
    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
  });

  it('does not render fleet status table in the issue-filter path', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(99);

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(true)   // fleet-checkpoint.json exists
      .mockResolvedValueOnce(false); // per-issue checkpoint.json does not exist
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints "No per-issue checkpoint found for issue #n" message', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No per-issue checkpoint found for issue #5'));
  });

  it('does not call renderIssueDetail when per-issue checkpoint is missing', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
  });

  it('does not instantiate CheckpointManager when per-issue checkpoint file is absent', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(5);

    expect(MockCheckpointManager).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — with issueNumber, per-issue checkpoint present', () => {
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
    mockRenderIssueDetail.mockReturnValue('issue detail table');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('instantiates CheckpointManager with the correct per-issue directory', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(MockCheckpointManager).toHaveBeenCalledOnce();
    const [progressDir] = MockCheckpointManager.mock.calls[0];
    expect(progressDir).toMatch(/issues[/\\]7$/);
  });

  it('calls renderIssueDetail with the issue number, fleet status, and checkpoint state', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(mockRenderIssueDetail).toHaveBeenCalledWith(7, issueStatus, issueCheckpointState);
  });

  it('prints the rendered issue detail', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(consoleSpy).toHaveBeenCalledWith('issue detail table');
  });

  it('does not call renderFleetStatus in the issue-filter path', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(7);

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.status() — with issueNumber, CheckpointManager.load() throws', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const issueStatus = {
    status: 'in-progress' as const,
    issueTitle: 'Inaccessible issue',
    worktreePath: '/tmp/inaccessible',
    branchName: 'cadre/issue-8',
    lastPhase: 1,
    updatedAt: new Date().toISOString(),
  };

  const fleetState = {
    projectName: 'test-project',
    issues: { 8: issueStatus },
    tokenUsage: { total: 0, byIssue: {} },
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Both fleet and issue checkpoint files exist, but load() throws
    mockExists.mockResolvedValue(true);

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(fleetState),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    MockCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints graceful message when CheckpointManager.load() throws', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(8);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No per-issue checkpoint found for issue #8'));
  });

  it('does not call renderIssueDetail when load() throws', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(8);

    expect(mockRenderIssueDetail).not.toHaveBeenCalled();
  });

  it('does not call renderFleetStatus when load() throws', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(8);

    expect(mockRenderFleetStatus).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime.reset() — setIssueStatus call-sites pass issueTitle', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockSetIssueStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function setUpCheckpoint(issues: Record<number, { status: string; issueTitle?: string }>) {
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({ issues }),
      setIssueStatus: mockSetIssueStatus,
    }));
  }

  it('calls setIssueStatus with not-started and issueTitle when resetting a single issue', async () => {
    setUpCheckpoint({
      42: { status: 'in-progress', issueTitle: 'Fix the login bug' },
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset(42);

    expect(mockSetIssueStatus).toHaveBeenCalledOnce();
    expect(mockSetIssueStatus).toHaveBeenCalledWith(42, 'not-started', '', '', 0, 'Fix the login bug');
  });

  it('falls back to empty string issueTitle when issue has no title in state', async () => {
    setUpCheckpoint({
      7: { status: 'failed' },
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset(7);

    expect(mockSetIssueStatus).toHaveBeenCalledWith(7, 'not-started', '', '', 0, '');
  });

  it('passes empty worktreePath, branchName, and lastPhase=0 when resetting a single issue', async () => {
    setUpCheckpoint({
      10: { status: 'completed', issueTitle: 'Refactor auth' },
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset(10);

    const [, status, worktreePath, branchName, lastPhase] = mockSetIssueStatus.mock.calls[0];
    expect(status).toBe('not-started');
    expect(worktreePath).toBe('');
    expect(branchName).toBe('');
    expect(lastPhase).toBe(0);
  });

  it('calls setIssueStatus for every issue when resetting the whole fleet', async () => {
    setUpCheckpoint({
      1: { status: 'completed', issueTitle: 'Issue one' },
      2: { status: 'failed', issueTitle: 'Issue two' },
      3: { status: 'in-progress', issueTitle: 'Issue three' },
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset();

    expect(mockSetIssueStatus).toHaveBeenCalledTimes(3);
    expect(mockSetIssueStatus).toHaveBeenCalledWith(1, 'not-started', '', '', 0, 'Issue one');
    expect(mockSetIssueStatus).toHaveBeenCalledWith(2, 'not-started', '', '', 0, 'Issue two');
    expect(mockSetIssueStatus).toHaveBeenCalledWith(3, 'not-started', '', '', 0, 'Issue three');
  });

  it('does not call setIssueStatus when resetting fleet with no issues', async () => {
    setUpCheckpoint({});

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset();

    expect(mockSetIssueStatus).not.toHaveBeenCalled();
  });

  it('passes issueTitle from existing state when resetting all issues in fleet', async () => {
    setUpCheckpoint({
      100: { status: 'completed', issueTitle: 'Add dark mode' },
      200: { status: 'failed', issueTitle: 'Fix crash on startup' },
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset();

    const titles = mockSetIssueStatus.mock.calls.map(([, , , , , title]) => title);
    expect(titles).toContain('Add dark mode');
    expect(titles).toContain('Fix crash on startup');
  });
});
