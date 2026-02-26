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
      failedIssues: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    }),
    runReviewResponse: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    }),
  })),
}));

const mockDag = { getWaves: vi.fn().mockReturnValue([[{ number: 1, title: 'Test issue' }]]) };

vi.mock('../src/core/dependency-resolver.js', () => ({
  DependencyResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn().mockResolvedValue(mockDag),
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

vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn().mockResolvedValue(''),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

vi.mock('../src/validation/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/validation/index.js')>();
  return {
    ...actual,
    PreRunValidationSuite: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(true),
    })),
    checkStaleState: vi.fn().mockResolvedValue({ hasConflicts: false, conflicts: new Map() }),
  };
});

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: {
    listReports: vi.fn().mockResolvedValue([]),
    readReport: vi.fn().mockResolvedValue({
      runId: 'run-001',
      project: 'test-project',
      duration: 5000,
      totalTokens: 1000,
      totals: { issues: 2, prsCreated: 1, failures: 0 },
      issues: [],
    }),
  },
}));

import { CadreRuntime } from '../src/core/runtime.js';
import { createNotificationManager } from '../src/notifications/manager.js';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { createPlatformProvider } from '../src/platform/factory.js';
import { FleetProgressWriter } from '../src/core/progress.js';
import { FleetCheckpointManager, CheckpointManager } from '../src/core/checkpoint.js';
import { exists } from '../src/util/fs.js';
import { checkStaleState } from '../src/validation/index.js';
import { DependencyResolver } from '../src/core/dependency-resolver.js';
import { DependencyResolutionError, StaleStateError, RuntimeInterruptedError } from '../src/errors.js';
import { ReportWriter } from '../src/reporting/report-writer.js';
import { PreRunValidationSuite } from '../src/validation/index.js';
import { WorktreeManager } from '../src/git/worktree.js';

const MockFleetOrchestrator = FleetOrchestrator as unknown as ReturnType<typeof vi.fn>;
const MockCreateNotificationManager = createNotificationManager as ReturnType<typeof vi.fn>;
const MockCreatePlatformProvider = createPlatformProvider as ReturnType<typeof vi.fn>;
const MockFleetProgressWriter = FleetProgressWriter as unknown as ReturnType<typeof vi.fn>;
const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;
const MockCheckpointManager = CheckpointManager as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as unknown as ReturnType<typeof vi.fn>;
const MockDependencyResolver = DependencyResolver as unknown as ReturnType<typeof vi.fn>;
const MockReportWriter = ReportWriter as unknown as { listReports: ReturnType<typeof vi.fn>; readReport: ReturnType<typeof vi.fn> };
const MockPreRunValidationSuite = PreRunValidationSuite as unknown as ReturnType<typeof vi.fn>;
const MockWorktreeManager = WorktreeManager as unknown as ReturnType<typeof vi.fn>;

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
        failedIssues: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
      }),
      runReviewResponse: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
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

  it('causes run() to reject with RuntimeInterruptedError(exitCode=130) on SIGINT', async () => {
    MockCreateNotificationManager.mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) });

    // Make fleet.run() never resolve so the interrupt can fire first
    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockReturnValue(new Promise(() => {})),
    }));

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    const runPromise = runtime.run();

    // Allow run() to reach the race
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const sigintHandler = capturedHandlers.get('SIGINT');
    expect(sigintHandler).toBeDefined();
    void sigintHandler!();

    await expect(runPromise).rejects.toMatchObject({
      name: 'RuntimeInterruptedError',
      exitCode: 130,
    });
  });

  it('causes run() to reject with RuntimeInterruptedError(exitCode=143) on SIGTERM', async () => {
    MockCreateNotificationManager.mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) });

    // Make fleet.run() never resolve so the interrupt can fire first
    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockReturnValue(new Promise(() => {})),
    }));

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    const runPromise = runtime.run();

    // Allow run() to reach the race
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const sigtermHandler = capturedHandlers.get('SIGTERM');
    expect(sigtermHandler).toBeDefined();
    void sigtermHandler!();

    await expect(runPromise).rejects.toMatchObject({
      name: 'RuntimeInterruptedError',
      exitCode: 143,
    });
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

describe('CadreRuntime — stale-state check wiring', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let mockCheckStaleState: ReturnType<typeof vi.fn>;

  function makeConfigWithValidation(issueIds = [42]) {
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
        skipValidation: false,
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

  beforeEach(() => {
    vi.clearAllMocks();

    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as (code?: number) => never);

    mockCheckStaleState = checkStaleState as unknown as ReturnType<typeof vi.fn>;
    mockCheckStaleState.mockResolvedValue({ hasConflicts: false, conflicts: new Map() });

    MockCreateNotificationManager.mockReturnValue({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listPullRequests: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue({
        number: 42,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: 'https://github.com/owner/repo/issues/42',
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
        failedIssues: [],
        codeDoneNoPR: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      }),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should skip the stale-state check when skipValidation is true', async () => {
    const config = makeConfig([42]); // skipValidation: true
    const runtime = new CadreRuntime(config);
    await runtime.run();
    expect(mockCheckStaleState).not.toHaveBeenCalled();
  });

  it('should skip the stale-state check when issues is a query (not explicit ids)', async () => {
    const config = makeRuntimeConfig({
      ...makeConfigWithValidation(),
      issues: { query: { state: 'open', limit: 10 } },
    });
    const mockProvider = {
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listIssues: vi.fn().mockResolvedValue([]),
      listPullRequests: vi.fn().mockResolvedValue([]),
    };
    MockCreatePlatformProvider.mockReturnValue(mockProvider);

    const runtime = new CadreRuntime(config);
    await runtime.run();
    expect(mockCheckStaleState).not.toHaveBeenCalled();
  });

  it('should run the stale-state check when skipValidation is false and ids are provided', async () => {
    const config = makeConfigWithValidation([42]);
    const runtime = new CadreRuntime(config);
    await runtime.run();
    expect(mockCheckStaleState).toHaveBeenCalledOnce();
  });

  it('should pass the issue ids to checkStaleState', async () => {
    const config = makeConfigWithValidation([10, 20]);
    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listPullRequests: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue({
        number: 10,
        title: 'Test issue',
        body: '',
        labels: [],
        state: 'open',
        url: '',
        author: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });
    const runtime = new CadreRuntime(config);
    await runtime.run();
    const [issueNumbers] = mockCheckStaleState.mock.calls[0];
    expect(issueNumbers).toEqual([10, 20]);
  });

  it('should throw StaleStateError when stale-state conflicts are found', async () => {
    const conflicts = new Map([[42, [{ kind: 'worktree', description: 'exists' }]]]);
    const staleResult = { hasConflicts: true, conflicts };
    mockCheckStaleState.mockResolvedValue(staleResult);

    const config = makeConfigWithValidation([42]);
    const runtime = new CadreRuntime(config);
    const err = await runtime.run().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StaleStateError);
    expect((err as StaleStateError).result).toBe(staleResult);
  });

  it('should not create FleetOrchestrator when stale-state conflicts are found', async () => {
    const conflicts = new Map([[42, [{ kind: 'worktree', description: 'exists' }]]]);
    mockCheckStaleState.mockResolvedValue({ hasConflicts: true, conflicts });

    const config = makeConfigWithValidation([42]);
    const runtime = new CadreRuntime(config);
    await runtime.run().catch(() => {});

    expect(MockFleetOrchestrator).not.toHaveBeenCalled();
  });

  it('should continue normally when checkStaleState returns no conflicts', async () => {
    mockCheckStaleState.mockResolvedValue({ hasConflicts: false, conflicts: new Map() });

    const config = makeConfigWithValidation([42]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockFleetOrchestrator).toHaveBeenCalledOnce();
  });

  it('should call provider.connect() before checkStaleState', async () => {
    const connectSpy = vi.fn().mockResolvedValue(undefined);
    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: connectSpy,
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listPullRequests: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue({
        number: 42, title: 'Test', body: '', labels: [], state: 'open',
        url: '', author: 'u', createdAt: '', updatedAt: '', comments: [],
      }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const config = makeConfigWithValidation([42]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    const connectCallOrder = connectSpy.mock.invocationCallOrder[0];
    const checkStaleCallOrder = mockCheckStaleState.mock.invocationCallOrder[0];
    expect(connectCallOrder).toBeLessThan(checkStaleCallOrder);
  });
});

describe('CadreRuntime — DAG wiring', () => {
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
        failedIssues: [],
        codeDoneNoPR: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      }),
    }));

    // Reset mock dag
    mockDag.getWaves.mockReturnValue([[{ number: 1, title: 'Test issue' }]]);

    MockDependencyResolver.mockImplementation(() => ({
      resolve: vi.fn().mockResolvedValue(mockDag),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('does not instantiate DependencyResolver when dag.enabled is false', async () => {
    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockDependencyResolver).not.toHaveBeenCalled();
  });

  it('instantiates DependencyResolver and calls resolve() when dag.enabled is true', async () => {
    const config = makeRuntimeConfig({
      ...makeConfig([1]),
      dag: { enabled: true, verifyDepsBuild: false, autoMerge: false },
    });
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockDependencyResolver).toHaveBeenCalledOnce();
    const resolverInstance = MockDependencyResolver.mock.results[0].value;
    expect(resolverInstance.resolve).toHaveBeenCalledOnce();
  });

  it('passes the resolved dag to FleetOrchestrator when dag.enabled is true', async () => {
    const config = makeRuntimeConfig({
      ...makeConfig([1]),
      dag: { enabled: true, verifyDepsBuild: false, autoMerge: false },
    });
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockFleetOrchestrator).toHaveBeenCalledOnce();
    const ctorArgs = MockFleetOrchestrator.mock.calls[0];
    // dag is the 8th argument (index 7)
    expect(ctorArgs[7]).toBe(mockDag);
  });

  it('passes undefined dag to FleetOrchestrator when dag.enabled is false', async () => {
    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    expect(MockFleetOrchestrator).toHaveBeenCalledOnce();
    const ctorArgs = MockFleetOrchestrator.mock.calls[0];
    expect(ctorArgs[7]).toBeUndefined();
  });

  it('aborts run with a clear error message when DependencyResolutionError is thrown', async () => {
    MockDependencyResolver.mockImplementation(() => ({
      resolve: vi.fn().mockRejectedValue(
        new DependencyResolutionError('Could not infer dependency graph'),
      ),
    }));

    const config = makeRuntimeConfig({
      ...makeConfig([1]),
      dag: { enabled: true, verifyDepsBuild: false, autoMerge: false },
    });
    const runtime = new CadreRuntime(config);

    await expect(runtime.run()).rejects.toThrow('DAG dependency resolution failed');
    expect(MockFleetOrchestrator).not.toHaveBeenCalled();
  });
});

describe('CadreRuntime — validate()', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    MockPreRunValidationSuite.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(true),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('should return true when all validators pass', async () => {
    MockPreRunValidationSuite.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(true),
    }));
    const runtime = new CadreRuntime(makeConfig());
    const result = await runtime.validate();
    expect(result).toBe(true);
  });

  it('should return false when validators fail', async () => {
    MockPreRunValidationSuite.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(false),
    }));
    const runtime = new CadreRuntime(makeConfig());
    const result = await runtime.validate();
    expect(result).toBe(false);
  });

  it('should instantiate PreRunValidationSuite with required validators', async () => {
    const runtime = new CadreRuntime(makeConfig());
    await runtime.validate();
    expect(MockPreRunValidationSuite).toHaveBeenCalledOnce();
    // Validators array passed as first arg should have elements
    const [validators] = MockPreRunValidationSuite.mock.calls[0];
    expect(Array.isArray(validators)).toBe(true);
    expect(validators.length).toBeGreaterThan(0);
  });
});

describe('CadreRuntime — reset()', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issues: {
          10: { status: 'completed', issueTitle: 'Issue 10', worktreePath: '', branchName: '', lastPhase: 5, updatedAt: '' },
          20: { status: 'in-progress', issueTitle: 'Issue 20', worktreePath: '', branchName: '', lastPhase: 3, updatedAt: '' },
        },
        tokenUsage: { total: 0, byIssue: {} },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
        version: 1,
        startedAt: '',
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('should reset a specific issue by number', async () => {
    const mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issues: {
          10: { status: 'completed', issueTitle: 'Issue 10', worktreePath: '', branchName: '', lastPhase: 5, updatedAt: '' },
        },
        tokenUsage: { total: 0, byIssue: {} },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
        version: 1,
        startedAt: '',
      }),
      setIssueStatus: mockSetIssueStatus,
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset(10);

    expect(mockSetIssueStatus).toHaveBeenCalledOnce();
    expect(mockSetIssueStatus).toHaveBeenCalledWith(10, 'not-started', '', '', 0, 'Issue 10');
    expect(consoleSpy).toHaveBeenCalledWith('Reset issue #10');
  });

  it('should reset all issues when no issue number is provided', async () => {
    const mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issues: {
          10: { status: 'completed', issueTitle: 'Issue 10', worktreePath: '', branchName: '', lastPhase: 5, updatedAt: '' },
          20: { status: 'in-progress', issueTitle: 'Issue 20', worktreePath: '', branchName: '', lastPhase: 3, updatedAt: '' },
        },
        tokenUsage: { total: 0, byIssue: {} },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
        version: 1,
        startedAt: '',
      }),
      setIssueStatus: mockSetIssueStatus,
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.reset();

    expect(mockSetIssueStatus).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith('Reset all issues');
  });
});

describe('CadreRuntime — report()', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    MockReportWriter.listReports.mockResolvedValue([]);
    MockReportWriter.readReport.mockResolvedValue({
      runId: 'run-001',
      project: 'test-project',
      duration: 5000,
      totalTokens: 1000,
      totals: { issues: 2, prsCreated: 1, failures: 0 },
      issues: [],
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('should print "No reports found." when no reports exist', async () => {
    MockReportWriter.listReports.mockResolvedValue([]);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.report();
    expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
  });

  it('should print report paths when history option is true and reports exist', async () => {
    MockReportWriter.listReports.mockResolvedValue(['/tmp/report-1.json', '/tmp/report-2.json']);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.report({ history: true });
    expect(consoleSpy).toHaveBeenCalledWith('/tmp/report-1.json');
    expect(consoleSpy).toHaveBeenCalledWith('/tmp/report-2.json');
  });

  it('should print "No reports found." for history option with no reports', async () => {
    MockReportWriter.listReports.mockResolvedValue([]);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.report({ history: true });
    expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
  });

  it('should print JSON when format is json', async () => {
    MockReportWriter.listReports.mockResolvedValue(['/tmp/report-1.json']);
    const report = { runId: 'run-001', project: 'test-project', duration: 5000, totalTokens: 1000, totals: { issues: 2, prsCreated: 1, failures: 0 }, issues: [] };
    MockReportWriter.readReport.mockResolvedValue(report);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.report({ format: 'json' });
    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(report));
  });

  it('should print human-readable summary for most recent report', async () => {
    MockReportWriter.listReports.mockResolvedValue(['/tmp/report-1.json']);
    MockReportWriter.readReport.mockResolvedValue({
      runId: 'run-abc',
      project: 'my-project',
      duration: 3000,
      totalTokens: 500,
      totals: { issues: 1, prsCreated: 1, failures: 0 },
      issues: [],
    });
    const runtime = new CadreRuntime(makeConfig());
    await runtime.report();
    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('run-abc');
    expect(output).toContain('my-project');
  });
});

describe('CadreRuntime — listWorktrees()', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('should print "No active worktrees" when none exist', async () => {
    MockWorktreeManager.mockImplementation(() => ({
      listActive: vi.fn().mockResolvedValue([]),
    }));
    const runtime = new CadreRuntime(makeConfig());
    await runtime.listWorktrees();
    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('No active worktrees');
  });

  it('should print worktree details when worktrees exist', async () => {
    MockWorktreeManager.mockImplementation(() => ({
      listActive: vi.fn().mockResolvedValue([
        { issueNumber: 42, path: '/tmp/wt-42', branch: 'cadre/issue-42', baseCommit: 'abc12345', exists: true, agentFiles: [] },
      ]),
    }));
    const runtime = new CadreRuntime(makeConfig());
    await runtime.listWorktrees();
    const output = consoleSpy.mock.calls.map(([msg]) => msg).join('\n');
    expect(output).toContain('Issue #42');
    expect(output).toContain('/tmp/wt-42');
    expect(output).toContain('cadre/issue-42');
  });
});

describe('CadreRuntime — pruneWorktrees()', () => {
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
      listPullRequests: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue({ number: 1, title: 'Test', body: '', labels: [], state: 'open', url: '', author: 'u', createdAt: '', updatedAt: '', comments: [] }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issues: {},
        tokenUsage: { total: 0, byIssue: {} },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
        version: 1,
        startedAt: '',
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('should prune worktrees that are locally completed', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    MockWorktreeManager.mockImplementation(() => ({
      listActive: vi.fn().mockResolvedValue([
        { issueNumber: 7, path: '/tmp/wt-7', branch: 'cadre/issue-7', baseCommit: 'abc1', exists: true, agentFiles: [] },
      ]),
      remove: mockRemove,
    }));

    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        issues: { 7: { status: 'completed', issueTitle: 'Issue 7', worktreePath: '', branchName: '', lastPhase: 5, updatedAt: '' } },
        tokenUsage: { total: 0, byIssue: {} },
        lastCheckpoint: '',
        resumeCount: 0,
        projectName: 'test',
        version: 1,
        startedAt: '',
      }),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
    }));

    const runtime = new CadreRuntime(makeConfig());
    await runtime.pruneWorktrees();

    expect(mockRemove).toHaveBeenCalledWith(7);
    const output = consoleSpy.mock.calls.map(([msg]) => String(msg)).join('\n');
    expect(output).toContain('Pruned: issue #7');
    expect(output).toContain('Pruned 1 worktrees');
  });

  it('should prune worktrees whose PR is closed on the platform', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    MockWorktreeManager.mockImplementation(() => ({
      listActive: vi.fn().mockResolvedValue([
        { issueNumber: 8, path: '/tmp/wt-8', branch: 'cadre/issue-8', baseCommit: 'abc2', exists: true, agentFiles: [] },
      ]),
      remove: mockRemove,
    }));

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listPullRequests: vi.fn().mockResolvedValue([
        { number: 99, headBranch: 'cadre/issue-8', state: 'closed', url: '' },
      ]),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.pruneWorktrees();

    expect(mockRemove).toHaveBeenCalledWith(8);
    const output = consoleSpy.mock.calls.map(([msg]) => String(msg)).join('\n');
    expect(output).toContain('Pruned: issue #8');
  });

  it('should skip worktrees whose PR is still open', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    MockWorktreeManager.mockImplementation(() => ({
      listActive: vi.fn().mockResolvedValue([
        { issueNumber: 9, path: '/tmp/wt-9', branch: 'cadre/issue-9', baseCommit: 'abc3', exists: true, agentFiles: [] },
      ]),
      remove: mockRemove,
    }));

    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      listPullRequests: vi.fn().mockResolvedValue([
        { number: 100, headBranch: 'cadre/issue-9', state: 'open', url: '' },
      ]),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const runtime = new CadreRuntime(makeConfig());
    await runtime.pruneWorktrees();

    expect(mockRemove).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map(([msg]) => String(msg)).join('\n');
    expect(output).toContain('Skipped: issue #9');
    expect(output).toContain('Pruned 0 worktrees');
  });
});

describe('CadreRuntime — resolveIssues() error handling', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    MockCreateNotificationManager.mockReturnValue({ dispatch: vi.fn().mockResolvedValue(undefined) });
    MockFleetOrchestrator.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        success: true,
        issues: [],
        prsCreated: [],
        failedIssues: [],
        codeDoneNoPR: [],
        totalDuration: 100,
        tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      }),
    }));
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('should continue processing other issues when one getIssue call fails', async () => {
    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn()
        .mockRejectedValueOnce(new Error('Issue not found'))
        .mockResolvedValueOnce({ number: 2, title: 'Issue 2', body: '', labels: [], state: 'open', url: '', author: 'u', createdAt: '', updatedAt: '', comments: [] }),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const config = makeConfig([1, 2]);
    const runtime = new CadreRuntime(config);
    await runtime.run();

    // FleetOrchestrator should be called with the 1 successfully fetched issue
    expect(MockFleetOrchestrator).toHaveBeenCalledOnce();
    const [, issues] = MockFleetOrchestrator.mock.calls[0];
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(2);
  });

  it('should return empty result when all getIssue calls fail', async () => {
    MockCreatePlatformProvider.mockReturnValue({
      name: 'github',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkAuth: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockRejectedValue(new Error('Not found')),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const config = makeConfig([1]);
    const runtime = new CadreRuntime(config);
    const result = await runtime.run();

    expect(MockFleetOrchestrator).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
