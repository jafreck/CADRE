import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueOrchestrator, BudgetExceededError } from '../src/core/issue-orchestrator.js';
import { NotificationManager } from '@cadre-dev/framework/notifications';
import { AnalysisAmbiguityGate } from '../src/core/phase-gate.js';
import * as fsUtils from '../src/util/fs.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import { makeMockIssue } from './helpers/make-mock-issue.js';
import { makeMockWorktree } from './helpers/make-mock-worktree.js';
import { makeMockLogger } from './helpers/make-mock-logger.js';
import { makeMockCheckpoint } from './helpers/make-mock-checkpoint.js';
import type { CheckpointManager } from '@cadre-dev/framework/engine';
import type { AgentLauncher } from '../src/agents/types.js';
import type { Logger } from '@cadre-dev/framework/core';

// ── Mock IssueNotifier so we can spy on lifecycle calls ──
const mockNotifierMethods = {
  notifyStart: vi.fn().mockResolvedValue(undefined),
  notifyPhaseComplete: vi.fn().mockResolvedValue(undefined),
  notifyComplete: vi.fn().mockResolvedValue(undefined),
  notifyFailed: vi.fn().mockResolvedValue(undefined),
  notifyBudgetWarning: vi.fn().mockResolvedValue(undefined),
  notifyAmbiguities: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockImplementation(async (event: { type: string }) => {
    // The real IssueNotifier.notify() dispatches to inner methods;
    // we replicate that routing here so assertions on the specific
    // methods still pass while the orchestrator goes through dispatch.
    switch (event.type) {
      case 'issue-started':
        return mockNotifierMethods.notifyStart((event as any).issueNumber, (event as any).issueTitle);
      case 'phase-completed':
        return mockNotifierMethods.notifyPhaseComplete((event as any).issueNumber, (event as any).phase, (event as any).phaseName, (event as any).duration);
      case 'issue-completed':
        return mockNotifierMethods.notifyComplete((event as any).issueNumber, (event as any).issueTitle, (event as any).prUrl, (event as any).tokenUsage);
      case 'issue-failed':
        return mockNotifierMethods.notifyFailed(
          (event as any).issueNumber,
          (event as any).issueTitle,
          (event as any).phaseName ? { id: (event as any).phase, name: (event as any).phaseName } : undefined,
          (event as any).failedTask,
          (event as any).error,
        );
      case 'budget-warning':
        if ((event as any).scope === 'issue' && (event as any).issueNumber != null) {
          return mockNotifierMethods.notifyBudgetWarning((event as any).issueNumber, (event as any).currentUsage, (event as any).budget);
        }
        return;
      case 'ambiguity-detected':
        return mockNotifierMethods.notifyAmbiguities((event as any).issueNumber, (event as any).ambiguities);
      default:
        return;
    }
  }),
};

vi.mock('../src/core/issue-notifier.js', () => ({
  IssueNotifier: vi.fn().mockImplementation(() => mockNotifierMethods),
}));

// Mock phase gates so they always pass
vi.mock('../src/core/phase-gate.js', () => {
  const makeGate = () => ({
    validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })),
  });
  return {
    AnalysisToPlanningGate: vi.fn(() => makeGate()),
    PlanningToImplementationGate: vi.fn(() => makeGate()),
    ImplementationToIntegrationGate: vi.fn(() => makeGate()),
    IntegrationToPRGate: vi.fn(() => makeGate()),
    AnalysisAmbiguityGate: vi.fn(() => makeGate()),
    listGatePlugins: vi.fn(() => []),
    registerGatePlugin: vi.fn(),
    unregisterGatePlugin: vi.fn(),
    clearGatePlugins: vi.fn(),
  };
});

// Mock heavy I/O and pipeline dependencies so unit tests stay fast and deterministic.
vi.mock('@cadre-dev/framework/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cadre-dev/framework/engine')>();
  return {
    ...actual,
    IssueProgressWriter: vi.fn().mockImplementation(() => ({
      appendEvent: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
    })),
    RetryExecutor: vi.fn().mockImplementation(() => ({})),
    TaskQueue: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(''),
    isClean: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue(undefined),
    stripCadreFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/agents/context-builder.js', () => ({
  ContextBuilder: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@cadre-dev/framework/runtime', () => ({
  TokenTracker: vi.fn().mockImplementation(() => ({
    getTotal: vi.fn().mockReturnValue(0),
    record: vi.fn(),
  })),
}));

vi.mock('../src/util/fs.js', () => ({
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  listFilesRecursive: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/util/process.js', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

// Default checkpoint mock – all phases are pre-completed so the phase loop skips everything.
const makeCheckpointMock = (overrides: Record<string, unknown> = {}) =>
  makeMockCheckpoint([1, 2, 3, 4, 5], {
    getResumePoint: vi.fn().mockReturnValue({ phase: 6, task: null }),
    isPhaseCompleted: vi.fn().mockReturnValue(true),
    ...overrides,
  });

// Alias used by notifier integration tests
function makeCheckpoint(overrides: Record<string, unknown> = {}): CheckpointManager {
  return makeCheckpointMock(overrides) as unknown as CheckpointManager;
}

function makeConfig(tokenBudget?: number) {
  return makeRuntimeConfig({
    issues: { ids: [42] },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      dryRun: false,
      resume: false,
      buildVerification: false,
      testVerification: false,
      perTaskBuildCheck: true,
      maxBuildFixRounds: 2,
      skipValidation: false,
      maxIntegrationFixRounds: 1,
      ambiguityThreshold: 5,
      haltOnAmbiguity: false,
      respondToReviews: false,
      invocationDelayMs: 0,
      tokenBudget: tokenBudget ?? undefined,
    } as any,
    commits: {
      commitPerPhase: false,
      squashBeforePR: false,
      conventional: true,
      sign: false,
    },
    pullRequest: {
      autoCreate: false,
      draft: false,
      linkIssue: false,
      labels: [],
      reviewers: [],
    },
    issueUpdates: {
      enabled: false,
      onStart: false,
      onPhaseComplete: false,
      onComplete: false,
      onFailed: false,
      onBudgetWarning: true,
    },
  });
}

const makeIssue = () => makeMockIssue({ url: 'https://github.com/owner/repo/issues/42' });
const makeWorktree = () => makeMockWorktree();
const makeLogger = () => makeMockLogger();

function makePlatform() {
  return {
    createPullRequest: vi.fn(),
    issueLinkSuffix: vi.fn().mockReturnValue(''),
  };
}

function makeLauncher() {
  return { launchAgent: vi.fn() };
}

describe('IssueOrchestrator – notification dispatch', () => {
  let config: ReturnType<typeof makeConfig>;
  let issue: ReturnType<typeof makeIssue>;
  let worktree: ReturnType<typeof makeWorktree>;
  let logger: Logger;
  let platform: ReturnType<typeof makePlatform>;
  let launcher: ReturnType<typeof makeLauncher>;

  beforeEach(() => {
    config = makeConfig();
    issue = makeIssue();
    worktree = makeWorktree();
    logger = makeLogger();
    platform = makePlatform();
    launcher = makeLauncher();
    vi.clearAllMocks();
  });

  it('should construct without a notificationManager', () => {
    const checkpoint = makeCheckpointMock();
    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );
    expect(orchestrator).toBeDefined();
  });

  it('should construct with a notificationManager', () => {
    const checkpoint = makeCheckpointMock();
    const nm = new NotificationManager(undefined);
    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
      nm,
    );
    expect(orchestrator).toBeDefined();
  });

  describe('run() – happy path (all phases pre-completed)', () => {
    it('should dispatch issue-started when notificationManager is provided', async () => {
      const checkpoint = makeCheckpointMock();
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      await orchestrator.run();

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'issue-started', issueNumber: 42 }),
      );
    });

    it('should dispatch issue-completed on successful pipeline', async () => {
      const checkpoint = makeCheckpointMock();
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      const result = await orchestrator.run();

      expect(result.success).toBe(true);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'issue-completed', issueNumber: 42, success: true }),
      );
    });

    it('should include duration and tokenUsage in issue-completed event', async () => {
      const checkpoint = makeCheckpointMock();
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      await orchestrator.run();

      const completedCall = dispatch.mock.calls.find(
        (args) => args[0]?.type === 'issue-completed',
      );
      expect(completedCall).toBeDefined();
      expect(completedCall![0]).toHaveProperty('duration');
      expect(completedCall![0]).toHaveProperty('tokenUsage');
    });

    it('should not throw when notificationManager is absent', async () => {
      const checkpoint = makeCheckpointMock();

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
      );

      await expect(orchestrator.run()).resolves.not.toThrow();
    });

    it('should return a successful IssueResult when all phases already completed', async () => {
      const checkpoint = makeCheckpointMock();

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
      );

      const result = await orchestrator.run();

      expect(result.issueNumber).toBe(42);
      expect(result.issueTitle).toBe('Test Issue');
      expect(result.success).toBe(true);
    });
  });

  describe('run() – critical phase failure', () => {
    // Phase 1 (Analysis & Scouting) is critical. We make it appear incomplete and then cause
    // the ensureDir call (which is inside the executePhase try block) to reject so that
    // executePhase returns { success: false }, triggering the issue-failed dispatch.

    it('should dispatch issue-failed when a critical phase fails', async () => {
      const checkpoint = makeCheckpointMock({
        isPhaseCompleted: vi.fn((id: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('simulated phase failure'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'issue-failed', issueNumber: 42 }),
      );
    });

    it('should include the failing phase id in the issue-failed event', async () => {
      const checkpoint = makeCheckpointMock({
        isPhaseCompleted: vi.fn((id: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('phase 1 error'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      await orchestrator.run();

      const failedCall = dispatch.mock.calls.find(
        (args) => args[0]?.type === 'issue-failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0]).toHaveProperty('phase', 1);
    });

    it('should not throw when notificationManager is absent and a critical phase fails', async () => {
      const checkpoint = makeCheckpointMock({
        isPhaseCompleted: vi.fn((id: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('phase 1 error'));

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
      );

      const result = await orchestrator.run();
      expect(result.success).toBe(false);
    });

    it('should not dispatch issue-completed when pipeline fails', async () => {
      const checkpoint = makeCheckpointMock({
        isPhaseCompleted: vi.fn((id: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('phase 1 error'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      await orchestrator.run();

      const completedCalls = dispatch.mock.calls.filter(
        (args) => args[0]?.type === 'issue-completed',
      );
      expect(completedCalls).toHaveLength(0);
    });
  });

  describe('run() – event ordering', () => {
    it('should dispatch issue-started before issue-completed', async () => {
      const checkpoint = makeCheckpointMock();
      const callOrder: string[] = [];
      const dispatch = vi.fn().mockImplementation((event: { type: string }) => {
        callOrder.push(event.type);
        return Promise.resolve(undefined);
      });
      const nm = { dispatch, addProvider: vi.fn() } as unknown as NotificationManager;

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        checkpoint as never,
        launcher as never,
        platform as never,
        logger,
        nm,
      );

      await orchestrator.run();

      const startedIdx = callOrder.indexOf('issue-started');
      const completedIdx = callOrder.indexOf('issue-completed');
      expect(startedIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThanOrEqual(0);
      expect(startedIdx).toBeLessThan(completedIdx);
    });
  });
});

describe('IssueOrchestrator notifier integration', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-apply default resolved values after clearAllMocks resets them
    mockNotifierMethods.notifyStart.mockResolvedValue(undefined);
    mockNotifierMethods.notifyPhaseComplete.mockResolvedValue(undefined);
    mockNotifierMethods.notifyComplete.mockResolvedValue(undefined);
    mockNotifierMethods.notifyFailed.mockResolvedValue(undefined);
    mockNotifierMethods.notifyBudgetWarning.mockResolvedValue(undefined);
    mockNotifierMethods.notifyAmbiguities.mockResolvedValue(undefined);
    // Re-apply notify routing after clearAllMocks
    mockNotifierMethods.notify.mockImplementation(async (event: { type: string }) => {
      switch (event.type) {
        case 'issue-started':
          return mockNotifierMethods.notifyStart((event as any).issueNumber, (event as any).issueTitle);
        case 'phase-completed':
          return mockNotifierMethods.notifyPhaseComplete((event as any).issueNumber, (event as any).phase, (event as any).phaseName, (event as any).duration);
        case 'issue-completed':
          return mockNotifierMethods.notifyComplete((event as any).issueNumber, (event as any).issueTitle, (event as any).prUrl, (event as any).tokenUsage);
        case 'issue-failed':
          return mockNotifierMethods.notifyFailed(
            (event as any).issueNumber,
            (event as any).issueTitle,
            (event as any).phaseName ? { id: (event as any).phase, name: (event as any).phaseName } : undefined,
            (event as any).failedTask,
            (event as any).error,
          );
        case 'budget-warning':
          if ((event as any).scope === 'issue' && (event as any).issueNumber != null) {
            return mockNotifierMethods.notifyBudgetWarning((event as any).issueNumber, (event as any).currentUsage, (event as any).budget);
          }
          return;
        case 'ambiguity-detected':
          return mockNotifierMethods.notifyAmbiguities((event as any).issueNumber, (event as any).ambiguities);
        default:
          return;
      }
    });
    tempDir = join(tmpdir(), `cadre-notif-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeLocalWorktree() {
    return makeMockWorktree({ path: worktreePath });
  }

  function makeOrchestrator(
    config: ReturnType<typeof makeConfig>,
    checkpoint: CheckpointManager,
    launcher: AgentLauncher,
    logger: Logger,
  ): IssueOrchestrator {
    return new IssueOrchestrator(
      config,
      makeIssue(),
      makeLocalWorktree(),
      checkpoint,
      launcher,
      makePlatform(),
      logger,
    );
  }

  it('should call notifyStart once when pipeline starts', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    await orchestrator.run();

    expect(mockNotifierMethods.notifyStart).toHaveBeenCalledOnce();
    expect(mockNotifierMethods.notifyStart).toHaveBeenCalledWith(42, 'Test Issue');
  });

  it('should call notifyPhaseComplete for each successfully completed phase when all phases run', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockResolvedValue({
        phase: 1,
        phaseName: 'Test Phase',
        success: true,
        duration: 100,
        tokenUsage: 0,
        outputPath: '',
      });

    await orchestrator.run();

    expect(mockNotifierMethods.notifyPhaseComplete).toHaveBeenCalledTimes(5);
  });

  it('should not call notifyPhaseComplete for already-completed (skipped) phases', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    await orchestrator.run();

    // Skipped phases do not trigger notifyPhaseComplete
    expect(mockNotifierMethods.notifyPhaseComplete).not.toHaveBeenCalled();
  });

  it('should call notifyComplete when pipeline succeeds', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    await orchestrator.run();

    expect(mockNotifierMethods.notifyComplete).toHaveBeenCalledOnce();
    expect(mockNotifierMethods.notifyComplete).toHaveBeenCalledWith(42, 'Test Issue', undefined, 0);
  });

  it('should call notifyFailed when budget is exceeded', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, makeLauncher(), makeLogger());

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockRejectedValue(new BudgetExceededError());

    await orchestrator.run();

    expect(mockNotifierMethods.notifyFailed).toHaveBeenCalledOnce();
    expect(mockNotifierMethods.notifyFailed).toHaveBeenCalledWith(
      42,
      'Test Issue',
      undefined,
      undefined,
      'Per-issue token budget exceeded',
    );
  });

  it('should call notifyFailed when a critical phase fails', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockResolvedValue({
        phase: 1,
        phaseName: 'Analysis & Scouting',
        success: false,
        duration: 50,
        tokenUsage: 0,
        error: 'agent crashed',
      });

    await orchestrator.run();

    expect(mockNotifierMethods.notifyFailed).toHaveBeenCalledOnce();
  });

  it('should not call notifyComplete when pipeline fails', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, makeLauncher(), makeLogger());

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockRejectedValue(new BudgetExceededError());

    await orchestrator.run();

    expect(mockNotifierMethods.notifyComplete).not.toHaveBeenCalled();
  });

  it('should not call notifyFailed when pipeline succeeds', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    await orchestrator.run();

    expect(mockNotifierMethods.notifyFailed).not.toHaveBeenCalled();
  });

  it('should not crash when notifyStart rejects', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => true) });
    mockNotifierMethods.notifyStart.mockRejectedValue(new Error('network failure'));
    const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

    await expect(orchestrator.run()).resolves.toBeDefined();
  });

  it('should not crash when notifyFailed rejects', async () => {
    const checkpoint = makeCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, makeLauncher(), makeLogger());

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockRejectedValue(new BudgetExceededError());

    mockNotifierMethods.notifyFailed.mockRejectedValue(new Error('network failure'));

    await expect(orchestrator.run()).resolves.toMatchObject({ success: false, budgetExceeded: true });
  });
});

describe('IssueOrchestrator — codeComplete field', () => {
  it('should include codeComplete field in the result', async () => {
    const checkpoint = makeCheckpointMock();
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result).toHaveProperty('codeComplete');
    expect(typeof result.codeComplete).toBe('boolean');
  });

  it('should return codeComplete: true when all phases pre-completed (phase 4 succeeded)', async () => {
    // Default mock: all phases pre-completed → phase 4 is included with success: true
    const checkpoint = makeCheckpointMock();
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result.codeComplete).toBe(true);
  });

  it('should return codeComplete: false when a critical phase (phase 1) fails before phase 4', async () => {
    // Only phase 1 runs and fails → phase 4 never runs → codeComplete is false
    const checkpoint = makeCheckpointMock({
      isPhaseCompleted: vi.fn(() => false),
    });
    vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('simulated phase 1 failure'));

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.codeComplete).toBe(false);
  });

  it('should return result.pr as undefined when no PR was created', async () => {
    // Default: all phases pre-completed, no actual PR phase runs → pr is undefined
    const checkpoint = makeCheckpointMock();
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result).toHaveProperty('pr');
    expect(result.pr).toBeUndefined();
  });
});
