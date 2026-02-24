import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

// Mock all heavy dependencies
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
    getIssue: vi.fn().mockResolvedValue({
      number: 1,
      title: 'Test issue',
      body: '',
      labels: [],
      state: 'open',
      url: 'https://github.com/owner/repo/issues/1',
      author: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    }),
    listIssues: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../src/notifications/manager.js', () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
  createNotificationManager: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    }),
    runReviewResponse: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    }),
  })),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({ issues: {}, tokenUsage: { total: 0, byIssue: {} }, lastCheckpoint: '', resumeCount: 0, projectName: 'test', version: 1, startedAt: '' }),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
  })),
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      issueNumber: 1,
      currentPhase: 1,
      completedPhases: [],
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      gateResults: {},
      currentTask: null,
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      version: 1,
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: '',
      lastCheckpoint: '',
      resumeCount: 0,
    }),
  })),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn(),
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
  phaseNames: [
    'Analysis & Scouting',
    'Planning',
    'Implementation',
    'Integration Verification',
    'PR Composition',
  ],
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

import { CadreRuntime } from '../src/core/runtime.js';
import { createNotificationManager } from '../src/notifications/manager.js';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { createPlatformProvider } from '../src/platform/factory.js';
import { FleetProgressWriter } from '../src/core/progress.js';
import { FleetCheckpointManager, CheckpointManager } from '../src/core/checkpoint.js';
import { exists } from '../src/util/fs.js';

const MockFleetOrchestrator = FleetOrchestrator as unknown as ReturnType<typeof vi.fn>;
const MockCreateNotificationManager = createNotificationManager as ReturnType<typeof vi.fn>;
const MockCreatePlatformProvider = createPlatformProvider as ReturnType<typeof vi.fn>;
const MockFleetProgressWriter = FleetProgressWriter as unknown as ReturnType<typeof vi.fn>;
const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;
const MockCheckpointManager = CheckpointManager as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as unknown as ReturnType<typeof vi.fn>;

function makeConfig(issueIds = [1]) {
  return makeRuntimeConfig({
    stateDir: '/tmp/cadre-state',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: issueIds },
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
    agent: {
      backend: 'copilot',
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude', agentDir: '.claude/agents' },
    },
  });
}

describe('CadreRuntime — NotificationManager wiring', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Prevent real SIGINT/SIGTERM listeners being registered on the process
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    MockCreateNotificationManager.mockReturnValue({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockResolvedValue({
        number: 1,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: 'https://github.com/owner/repo/issues/1',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
    }));
  });

  it('calls createNotificationManager with the config in the constructor', () => {
    const config = makeConfig();
    new CadreRuntime(config);
    expect(MockCreateNotificationManager).toHaveBeenCalledOnce();
    expect(MockCreateNotificationManager).toHaveBeenCalledWith(config);
  });

  it('passes the NotificationManager instance to FleetOrchestrator', async () => {
    const mockNotifications = { dispatch: vi.fn().mockResolvedValue(undefined) };
    MockCreateNotificationManager.mockReturnValue(mockNotifications);

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockFleetOrchestrator).toHaveBeenCalledOnce();
    const ctorArgs = MockFleetOrchestrator.mock.calls[0];
    // notifications is the 7th argument (index 6)
    expect(ctorArgs[6]).toBe(mockNotifications);
  });

  it('returns an empty FleetResult when no issues are resolved', async () => {
    const mockProvider = {
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listIssues: vi.fn().mockResolvedValue([]),
    };
    MockCreatePlatformProvider.mockReturnValue(mockProvider);

    const config = makeRuntimeConfig({ ...makeConfig(), issues: { query: { state: 'open', limit: 10 } } });
    const runtime = new CadreRuntime(config);
    const result = await runtime.run();

    expect(result).toMatchObject({
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
    });
    // FleetOrchestrator should not be instantiated if there are no issues
    expect(MockFleetOrchestrator).not.toHaveBeenCalled();
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });
});

/** Flush all pending microtasks and a macrotask so async fire-and-forget handlers complete. */
const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe('CadreRuntime — review-response routing', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    MockCreateNotificationManager.mockReturnValue({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockResolvedValue({
        number: 1,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: 'https://github.com/owner/repo/issues/1',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
      runReviewResponse: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('calls fleet.runReviewResponse() when respondToReviews is true', async () => {
    const config = makeRuntimeConfig({ ...makeConfig([1]), options: { ...makeConfig([1]).options, respondToReviews: true } });
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const fleetInstance = MockFleetOrchestrator.mock.results[0].value;
    expect(fleetInstance.runReviewResponse).toHaveBeenCalledOnce();
    expect(fleetInstance.run).not.toHaveBeenCalled();
  });

  it('calls fleet.run() when respondToReviews is false (default)', async () => {
    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const fleetInstance = MockFleetOrchestrator.mock.results[0].value;
    expect(fleetInstance.run).toHaveBeenCalledOnce();
    expect(fleetInstance.runReviewResponse).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime — shutdown handler dispatches fleet-interrupted', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  // Each stored handler calls the raw listener and waits for async completion
  const capturedHandlers: Map<string, () => Promise<void>> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandlers.clear();

    // Restore FleetProgressWriter implementation after clearAllMocks
    MockFleetProgressWriter.mockImplementation(() => ({
      write: vi.fn().mockResolvedValue(undefined),
      appendEvent: vi.fn().mockResolvedValue(undefined),
    }));

    processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, rawListener: (...args: unknown[]) => void) => {
      if (event === 'SIGINT' || event === 'SIGTERM') {
        // The runtime wraps the async handler in `() => void handler(signal)`,
        // so we store an awaitable version that calls the listener and flushes async work.
        capturedHandlers.set(event as string, async () => {
          rawListener();
          await flushAsync();
        });
      }
      return process;
    });

    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as (code?: number) => never);

    MockCreateNotificationManager.mockReturnValue({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockResolvedValue({
        number: 1,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: 'https://github.com/owner/repo/issues/1',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('registers SIGINT and SIGTERM handlers on run()', async () => {
    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const registeredEvents = processOnSpy.mock.calls.map(([event]) => event);
    expect(registeredEvents).toContain('SIGINT');
    expect(registeredEvents).toContain('SIGTERM');
  });

  it('dispatches fleet-interrupted with SIGINT signal on SIGINT', async () => {
    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    MockCreateNotificationManager.mockReturnValue({ dispatch: dispatchSpy });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigintHandler = capturedHandlers.get('SIGINT');
    expect(sigintHandler).toBeDefined();
    await sigintHandler!();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet-interrupted',
        signal: 'SIGINT',
        issuesInProgress: expect.any(Array),
      }),
    );
  });

  it('dispatches fleet-interrupted with SIGTERM signal on SIGTERM', async () => {
    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    MockCreateNotificationManager.mockReturnValue({ dispatch: dispatchSpy });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigtermHandler = capturedHandlers.get('SIGTERM');
    expect(sigtermHandler).toBeDefined();
    await sigtermHandler!();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet-interrupted',
        signal: 'SIGTERM',
        issuesInProgress: expect.any(Array),
      }),
    );
  });

  it('includes active issue numbers in fleet-interrupted event', async () => {
    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    MockCreateNotificationManager.mockReturnValue({ dispatch: dispatchSpy });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn()
        .mockResolvedValueOnce({ number: 10, title: 'Issue 10', body: '', labels: [], state: 'open', url: '', author: 'u', createdAt: '', updatedAt: '', comments: [] })
        .mockResolvedValueOnce({ number: 20, title: 'Issue 20', body: '', labels: [], state: 'open', url: '', author: 'u', createdAt: '', updatedAt: '', comments: [] }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const config = makeConfig([10, 20]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigintHandler = capturedHandlers.get('SIGINT');
    await sigintHandler!();

    const interruptedCall = dispatchSpy.mock.calls.find(([e]) => e.type === 'fleet-interrupted');
    expect(interruptedCall).toBeDefined();
    expect(interruptedCall![0].issuesInProgress).toEqual(expect.arrayContaining([10, 20]));
    expect(interruptedCall![0].issuesInProgress).toHaveLength(2);
  });

  it('calls process.exit(130) on SIGINT', async () => {
    MockCreateNotificationManager.mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigintHandler = capturedHandlers.get('SIGINT');
    await sigintHandler!();

    expect(processExitSpy).toHaveBeenCalledWith(130);
  });

  it('calls process.exit(143) on SIGTERM', async () => {
    MockCreateNotificationManager.mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigtermHandler = capturedHandlers.get('SIGTERM');
    await sigtermHandler!();

    expect(processExitSpy).toHaveBeenCalledWith(143);
  });

  it('does not dispatch fleet-interrupted twice if handler is called multiple times', async () => {
    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    MockCreateNotificationManager.mockReturnValue({ dispatch: dispatchSpy });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const sigintHandler = capturedHandlers.get('SIGINT');
    // Call the handler twice simulating double-signal
    await sigintHandler!();
    await sigintHandler!();

    const interruptedCalls = dispatchSpy.mock.calls.filter(([e]) => e.type === 'fleet-interrupted');
    expect(interruptedCalls).toHaveLength(1);
  });
});

describe('CadreRuntime — status() rendering', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockExists.mockResolvedValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('prints "No fleet checkpoint found." when no checkpoint file exists', async () => {
    mockExists.mockResolvedValue(false);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();
    expect(consoleSpy).toHaveBeenCalledWith('No fleet checkpoint found.');
  });

  it('renders summary header with project name and total tokens', async () => {
    mockExists.mockResolvedValue(true);
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        projectName: 'my-awesome-project',
        tokenUsage: { total: 0, byIssue: {} },
        issues: {},
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
        version: 1,
        startedAt: new Date().toISOString(),
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('my-awesome-project');
    expect(output).toContain('Total Tokens: 0');
  });

  it('renders issue table with issue title and human-readable phase name', async () => {
    mockExists.mockResolvedValue(true);
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        projectName: 'test-project',
        tokenUsage: { total: 0, byIssue: {} },
        issues: {
          42: {
            status: 'in-progress',
            issueTitle: 'Fix the widget bug',
            worktreePath: '/tmp/wt',
            branchName: 'cadre/issue-42',
            lastPhase: 2,
            updatedAt: new Date().toISOString(),
          },
        },
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
        version: 1,
        startedAt: new Date().toISOString(),
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.status();

    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('Fix the widget bug');
    expect(output).toContain('Planning'); // human-readable name for lastPhase=2 (phaseNames[1])
  });

  it('renders per-issue breakdown when an issue number is provided', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.includes('checkpoint')),
    );

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        projectName: 'test-project',
        tokenUsage: { total: 0, byIssue: {} },
        issues: {
          42: {
            status: 'in-progress',
            issueTitle: 'Fix the widget bug',
            worktreePath: '/tmp/wt',
            branchName: 'cadre/issue-42',
            lastPhase: 3,
            updatedAt: new Date().toISOString(),
          },
        },
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
        version: 1,
        startedAt: new Date().toISOString(),
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    MockCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issueNumber: 42,
        currentPhase: 3,
        completedPhases: [1, 2],
        tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
        gateResults: {},
        currentTask: null,
        completedTasks: [],
        failedTasks: [],
        blockedTasks: [],
        phaseOutputs: {},
        version: 1,
        worktreePath: '/tmp/wt',
        branchName: 'cadre/issue-42',
        baseCommit: 'abc123',
        startedAt: new Date().toISOString(),
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
      }),
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.status(42);

    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('Issue #42');
    expect(output).toContain('Fix the widget bug');
    expect(output).toContain('Implementation'); // phaseNames[2] for phase 3
  });
});

describe('CadreRuntime — printSummary code-done-no-pr display', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    MockCreateNotificationManager.mockReturnValue({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockResolvedValue({
        number: 1,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: 'https://github.com/owner/repo/issues/1',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('prints "Code Done (No PR): N" line and lists affected issue numbers', async () => {
    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [
          { issueNumber: 7, issueTitle: 'Add feature' },
          { issueNumber: 13, issueTitle: 'Fix bug' },
        ],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
    }));

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('Code Done (No PR): 2');
    expect(output).toContain('Code Done (No PR):');
    expect(output).toContain('#7');
    expect(output).toContain('#13');
  });

  it('does not print code-done-no-pr section when list is empty', async () => {
    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        codeDoneNoPR: [],
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
    }));

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('Code Done (No PR): 0');
    // The section header should not appear (only the summary line)
    expect(output).not.toContain('Code Done (No PR):\n');
  });
});
