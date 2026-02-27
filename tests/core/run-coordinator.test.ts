import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from '../helpers/make-runtime-config.js';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../../src/util/fs.js', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/process.js', () => ({
  killAllTrackedProcesses: vi.fn(),
}));

vi.mock('../../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      codeDoneNoPR: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
    }),
    runReviewResponse: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      codeDoneNoPR: [],
      totalDuration: 100,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
    }),
  })),
}));

vi.mock('../../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('../../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockDag = { getWaves: vi.fn().mockReturnValue([[{ number: 1, title: 'Test issue' }]]) };

vi.mock('../../src/core/dependency-resolver.js', () => ({
  DependencyResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn().mockResolvedValue(mockDag),
  })),
}));

vi.mock('../../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue(0),
    format: vi.fn().mockReturnValue('$0.00'),
  })),
}));

vi.mock('../../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({ raw: vi.fn().mockResolvedValue('') })),
}));

vi.mock('../../src/validation/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/validation/index.js')>();
  return {
    ...actual,
    PreRunValidationSuite: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue(true),
    })),
    checkStaleState: vi.fn().mockResolvedValue({ hasConflicts: false, conflicts: new Map() }),
  };
});

import { RunCoordinator } from '../../src/core/run-coordinator.js';
import { FleetOrchestrator } from '../../src/core/fleet-orchestrator.js';
import { DependencyResolver } from '../../src/core/dependency-resolver.js';
import { PreRunValidationSuite, checkStaleState } from '../../src/validation/index.js';
import { ensureDir } from '../../src/util/fs.js';
import { DependencyResolutionError, StaleStateError, RuntimeInterruptedError } from '../../src/errors.js';
import { killAllTrackedProcesses } from '../../src/util/process.js';
import type { RuntimeConfig } from '../../src/config/loader.js';
import type { PlatformProvider } from '../../src/platform/provider.js';
import type { NotificationManager } from '../../src/notifications/manager.js';

const MockFleetOrchestrator = FleetOrchestrator as unknown as ReturnType<typeof vi.fn>;
const MockDependencyResolver = DependencyResolver as unknown as ReturnType<typeof vi.fn>;
const MockPreRunValidationSuite = PreRunValidationSuite as unknown as ReturnType<typeof vi.fn>;
const mockCheckStaleState = checkStaleState as ReturnType<typeof vi.fn>;
const mockEnsureDir = ensureDir as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<PlatformProvider> = {}): PlatformProvider {
  return {
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
    ...overrides,
  } as unknown as PlatformProvider;
}

function makeNotifications(): NotificationManager {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationManager;
}

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return makeRuntimeConfig({
    stateDir: '/tmp/cadre-state',
    issues: { ids: [1] },
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
    ...overrides,
  });
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RunCoordinator', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  describe('validate()', () => {
    it('should return true when all validators pass', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const result = await coordinator.validate();
      expect(result).toBe(true);
    });

    it('should return false when validators fail', async () => {
      MockPreRunValidationSuite.mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue(false),
      }));
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const result = await coordinator.validate();
      expect(result).toBe(false);
    });

    it('should instantiate PreRunValidationSuite with required validators', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.validate();
      expect(MockPreRunValidationSuite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'git' }),
          expect.objectContaining({ name: 'agent-backend-validator' }),
          expect.objectContaining({ name: 'platform' }),
          expect.objectContaining({ name: 'command' }),
          expect.objectContaining({ name: 'disk' }),
        ]),
      );
    });
  });

  describe('run() — happy path', () => {
    it('should ensure the state directory exists', async () => {
      const config = makeConfig();
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(mockEnsureDir).toHaveBeenCalledWith(config.stateDir);
    });

    it('should connect to the platform provider', async () => {
      const provider = makeProvider();
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.connect).toHaveBeenCalled();
    });

    it('should verify authentication', async () => {
      const provider = makeProvider();
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.checkAuth).toHaveBeenCalled();
    });

    it('should return a FleetResult on success', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const result = await coordinator.run();
      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it('should disconnect the provider after the run', async () => {
      const provider = makeProvider();
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.disconnect).toHaveBeenCalled();
    });

    it('should print a summary with duration and token count', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CADRE Fleet Summary'));
    });

    it('should register SIGINT and SIGTERM handlers', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });
  });

  describe('run() — empty issues', () => {
    it('should return an empty result when no issues are resolved', async () => {
      const provider = makeProvider({
        getIssue: vi.fn().mockRejectedValue(new Error('not found')),
      });
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      const result = await coordinator.run();

      expect(result.success).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.prsCreated).toEqual([]);
    });

    it('should disconnect provider when no issues are resolved', async () => {
      const provider = makeProvider({
        getIssue: vi.fn().mockRejectedValue(new Error('not found')),
      });
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.disconnect).toHaveBeenCalled();
    });
  });

  describe('run() — authentication failure', () => {
    it('should throw when authentication fails', async () => {
      const provider = makeProvider({
        checkAuth: vi.fn().mockResolvedValue(false),
      });
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), provider, makeNotifications());
      await expect(coordinator.run()).rejects.toThrow('authentication failed');
    });
  });

  describe('run() — validation', () => {
    it('should skip validation when skipValidation is true', async () => {
      const config = makeConfig({
        options: {
          ...makeConfig().options,
          skipValidation: true,
        },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(MockPreRunValidationSuite).not.toHaveBeenCalled();
    });

    it('should run validation when skipValidation is false', async () => {
      const config = makeConfig({
        options: {
          ...makeConfig().options,
          skipValidation: false,
        },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(MockPreRunValidationSuite).toHaveBeenCalled();
    });

    it('should throw when validation fails', async () => {
      MockPreRunValidationSuite.mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue(false),
      }));
      const config = makeConfig({
        options: {
          ...makeConfig().options,
          skipValidation: false,
        },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await expect(coordinator.run()).rejects.toThrow('Pre-run validation failed');
    });
  });

  describe('run() — stale-state check', () => {
    it('should run stale-state check when skipValidation is false and explicit ids are provided', async () => {
      const config = makeConfig({
        issues: { ids: [42] },
        options: { ...makeConfig().options, skipValidation: false },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(mockCheckStaleState).toHaveBeenCalledWith(
        [42],
        config,
        expect.anything(),
        expect.anything(),
      );
    });

    it('should skip stale-state check when issues is a query', async () => {
      const config = makeConfig({
        issues: { query: { labels: ['bug'], limit: 5 } } as any,
        options: { ...makeConfig().options, skipValidation: false },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(mockCheckStaleState).not.toHaveBeenCalled();
    });

    it('should throw StaleStateError when stale-state conflicts are found', async () => {
      mockCheckStaleState.mockResolvedValueOnce({
        hasConflicts: true,
        conflicts: new Map([[42, [{ kind: 'worktree', description: 'stale' }]]]),
      });
      const config = makeConfig({
        issues: { ids: [42] },
        options: { ...makeConfig().options, skipValidation: false },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await expect(coordinator.run()).rejects.toThrow(StaleStateError);
    });
  });

  describe('run() — issue resolution', () => {
    it('should fetch explicit issue IDs from the provider', async () => {
      const provider = makeProvider();
      const config = makeConfig({ issues: { ids: [1, 2] } });
      const coordinator = new RunCoordinator(config, makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.getIssue).toHaveBeenCalledWith(1);
      expect(provider.getIssue).toHaveBeenCalledWith(2);
    });

    it('should use listIssues for query-based issue resolution', async () => {
      const provider = makeProvider();
      const config = makeConfig({
        issues: { query: { labels: ['bug'], limit: 5 } } as any,
      });
      const coordinator = new RunCoordinator(config, makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.listIssues).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['bug'], limit: 5 }),
      );
    });

    it('should continue processing when one getIssue call fails', async () => {
      const provider = makeProvider({
        getIssue: vi.fn()
          .mockRejectedValueOnce(new Error('not found'))
          .mockResolvedValueOnce({
            number: 2,
            title: 'Issue 2',
            body: '',
            labels: [],
            state: 'open',
            url: 'https://github.com/owner/repo/issues/2',
            author: 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comments: [],
          }),
      });
      const logger = makeLogger();
      const config = makeConfig({ issues: { ids: [1, 2] } });
      const coordinator = new RunCoordinator(config, logger, provider, makeNotifications());
      await coordinator.run();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch issue #1'),
        expect.anything(),
      );
    });
  });

  describe('run() — DAG wiring', () => {
    it('should not instantiate DependencyResolver when dag is not enabled', async () => {
      const config = makeConfig();
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(MockDependencyResolver).not.toHaveBeenCalled();
    });

    it('should instantiate DependencyResolver when dag.enabled is true', async () => {
      const config = makeConfig({ dag: { enabled: true } } as any);
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(MockDependencyResolver).toHaveBeenCalled();
    });

    it('should pass the resolved dag to FleetOrchestrator', async () => {
      const config = makeConfig({ dag: { enabled: true } } as any);
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      // FleetOrchestrator is called with dag as the last argument
      const lastArg = MockFleetOrchestrator.mock.calls[0][7];
      expect(lastArg).toBe(mockDag);
    });

    it('should pass undefined dag when dag is not enabled', async () => {
      const config = makeConfig();
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      const lastArg = MockFleetOrchestrator.mock.calls[0][7];
      expect(lastArg).toBeUndefined();
    });

    it('should throw with a clear message when DependencyResolutionError occurs', async () => {
      MockDependencyResolver.mockImplementationOnce(() => ({
        resolve: vi.fn().mockRejectedValue(new DependencyResolutionError('cycle detected')),
      }));
      const config = makeConfig({ dag: { enabled: true } } as any);
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await expect(coordinator.run()).rejects.toThrow('DAG dependency resolution failed: cycle detected');
    });
  });

  describe('run() — review-response routing', () => {
    it('should call fleet.runReviewResponse() when respondToReviews is true', async () => {
      const config = makeConfig({
        options: { ...makeConfig().options, respondToReviews: true },
      });
      const coordinator = new RunCoordinator(config, makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();

      const fleetInstance = MockFleetOrchestrator.mock.results[0].value;
      expect(fleetInstance.runReviewResponse).toHaveBeenCalled();
      expect(fleetInstance.run).not.toHaveBeenCalled();
    });

    it('should call fleet.run() when respondToReviews is false', async () => {
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();

      const fleetInstance = MockFleetOrchestrator.mock.results[0].value;
      expect(fleetInstance.run).toHaveBeenCalled();
      expect(fleetInstance.runReviewResponse).not.toHaveBeenCalled();
    });
  });

  describe('run() — summary printing', () => {
    it('should print PR links when PRs are created', async () => {
      MockFleetOrchestrator.mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          success: true,
          issues: [{ number: 1 }],
          prsCreated: [{ number: 10, url: 'https://github.com/owner/repo/pull/10' }],
          failedIssues: [],
          codeDoneNoPR: [],
          totalDuration: 5000,
          tokenUsage: { total: 100, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
        }),
      }));
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('#10'));
    });

    it('should print failure details when issues fail', async () => {
      MockFleetOrchestrator.mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          success: false,
          issues: [{ number: 1 }],
          prsCreated: [],
          failedIssues: [{ issueNumber: 1, error: 'build failed' }],
          codeDoneNoPR: [],
          totalDuration: 5000,
          tokenUsage: { total: 100, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
        }),
      }));
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      await coordinator.run();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('build failed'));
    });
  });

  describe('shutdown handlers', () => {
    it('should dispatch fleet-interrupted notification on SIGINT', async () => {
      processOnSpy.mockRestore();
      const handlers: Record<string, (() => void)[]> = {};
      processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
        return process;
      });

      const notifications = makeNotifications();
      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), notifications);

      // Start run but don't await — we'll trigger the signal handler
      const runPromise = coordinator.run().catch(() => {});

      // Give it time to set up handlers
      await new Promise((r) => setTimeout(r, 10));

      if (handlers['SIGINT']?.length) {
        handlers['SIGINT'][handlers['SIGINT'].length - 1]();
      }

      await new Promise((r) => setTimeout(r, 10));
      await runPromise;

      expect(notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'fleet-interrupted', signal: 'SIGINT' }),
      );
    });

    it('should call killAllTrackedProcesses on shutdown', async () => {
      processOnSpy.mockRestore();
      const handlers: Record<string, (() => void)[]> = {};
      processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
        return process;
      });

      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const runPromise = coordinator.run().catch(() => {});

      await new Promise((r) => setTimeout(r, 10));

      if (handlers['SIGTERM']?.length) {
        handlers['SIGTERM'][handlers['SIGTERM'].length - 1]();
      }

      await new Promise((r) => setTimeout(r, 10));
      await runPromise;

      expect(killAllTrackedProcesses).toHaveBeenCalled();
    });

    it('should cause run() to reject with RuntimeInterruptedError on SIGINT', async () => {
      processOnSpy.mockRestore();
      const handlers: Record<string, (() => void)[]> = {};
      processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
        return process;
      });

      // Make fleet.run() hang so the signal can interrupt it
      MockFleetOrchestrator.mockImplementationOnce(() => ({
        run: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
      }));

      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const runPromise = coordinator.run();

      await new Promise((r) => setTimeout(r, 10));

      if (handlers['SIGINT']?.length) {
        handlers['SIGINT'][handlers['SIGINT'].length - 1]();
      }

      await expect(runPromise).rejects.toThrow(RuntimeInterruptedError);
    });

    it('should reject with exit code 130 for SIGINT', async () => {
      processOnSpy.mockRestore();
      const handlers: Record<string, (() => void)[]> = {};
      processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
        return process;
      });

      MockFleetOrchestrator.mockImplementationOnce(() => ({
        run: vi.fn().mockReturnValue(new Promise(() => {})),
      }));

      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const runPromise = coordinator.run();

      await new Promise((r) => setTimeout(r, 10));

      if (handlers['SIGINT']?.length) {
        handlers['SIGINT'][handlers['SIGINT'].length - 1]();
      }

      try {
        await runPromise;
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeInterruptedError);
        expect((err as RuntimeInterruptedError).exitCode).toBe(130);
      }
    });

    it('should reject with exit code 143 for SIGTERM', async () => {
      processOnSpy.mockRestore();
      const handlers: Record<string, (() => void)[]> = {};
      processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(handler);
        return process;
      });

      MockFleetOrchestrator.mockImplementationOnce(() => ({
        run: vi.fn().mockReturnValue(new Promise(() => {})),
      }));

      const coordinator = new RunCoordinator(makeConfig(), makeLogger(), makeProvider(), makeNotifications());
      const runPromise = coordinator.run();

      await new Promise((r) => setTimeout(r, 10));

      if (handlers['SIGTERM']?.length) {
        handlers['SIGTERM'][handlers['SIGTERM'].length - 1]();
      }

      try {
        await runPromise;
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeInterruptedError);
        expect((err as RuntimeInterruptedError).exitCode).toBe(143);
      }
    });
  });

  describe('run() — query with DAG removes limit', () => {
    it('should pass undefined limit when DAG is enabled for query-based issues', async () => {
      const provider = makeProvider();
      const config = makeConfig({
        issues: { query: { labels: ['bug'], limit: 5 } } as any,
        dag: { enabled: true } as any,
      });
      const coordinator = new RunCoordinator(config, makeLogger(), provider, makeNotifications());
      await coordinator.run();
      expect(provider.listIssues).toHaveBeenCalledWith(
        expect.objectContaining({ limit: undefined }),
      );
    });
  });
});
