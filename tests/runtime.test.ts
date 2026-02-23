import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

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
    load: vi.fn().mockResolvedValue({ issues: {}, tokenUsage: { total: 0 }, lastCheckpoint: '', resumeCount: 0, projectName: 'test' }),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
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

import { CadreRuntime } from '../src/core/runtime.js';
import { createNotificationManager } from '../src/notifications/manager.js';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { createPlatformProvider } from '../src/platform/factory.js';
import { FleetProgressWriter } from '../src/core/progress.js';

const MockFleetOrchestrator = FleetOrchestrator as unknown as ReturnType<typeof vi.fn>;
const MockCreateNotificationManager = createNotificationManager as ReturnType<typeof vi.fn>;
const MockCreatePlatformProvider = createPlatformProvider as ReturnType<typeof vi.fn>;
const MockFleetProgressWriter = FleetProgressWriter as unknown as ReturnType<typeof vi.fn>;

function makeConfig(issueIds = [1]): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
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
      skipValidation: true,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4', agentDir: '.github/agents', timeout: 300000, costOverrides: {} },
    notifications: { enabled: false, providers: [] },
  } as unknown as CadreConfig;
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

    const config = { ...makeConfig(), issues: { query: { state: 'open' } } } as unknown as CadreConfig;
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
