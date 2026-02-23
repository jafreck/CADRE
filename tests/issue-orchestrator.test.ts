import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueOrchestrator, BudgetExceededError } from '../src/core/issue-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import * as fsUtils from '../src/util/fs.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/agents/types.js';
import type { Logger } from '../src/logging/logger.js';

// ── Mock IssueNotifier so we can spy on lifecycle calls ──
const mockNotifierMethods = {
  notifyStart: vi.fn().mockResolvedValue(undefined),
  notifyPhaseComplete: vi.fn().mockResolvedValue(undefined),
  notifyComplete: vi.fn().mockResolvedValue(undefined),
  notifyFailed: vi.fn().mockResolvedValue(undefined),
  notifyBudgetWarning: vi.fn().mockResolvedValue(undefined),
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
  };
});

// Mock heavy I/O and pipeline dependencies so unit tests stay fast and deterministic.
vi.mock('../src/core/progress.js', () => ({
  IssueProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(''),
    isClean: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/agents/context-builder.js', () => ({
  ContextBuilder: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/execution/retry.js', () => ({
  RetryExecutor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/execution/task-queue.js', () => ({
  TaskQueue: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/budget/token-tracker.js', () => ({
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
const makeCheckpointMock = (overrides: Record<string, unknown> = {}) => ({
  getResumePoint: vi.fn().mockReturnValue({ phase: 6, task: null }),
  isPhaseCompleted: vi.fn().mockReturnValue(true),
  isTaskCompleted: vi.fn().mockReturnValue(false),
  startPhase: vi.fn().mockResolvedValue(undefined),
  completePhase: vi.fn().mockResolvedValue(undefined),
  startTask: vi.fn().mockResolvedValue(undefined),
  completeTask: vi.fn().mockResolvedValue(undefined),
  blockTask: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    issueNumber: 42,
    currentPhase: 5,
    completedPhases: [1, 2, 3, 4, 5],
    completedTasks: [],
    blockedTasks: [],
    resumeCount: 0,
    currentTask: null,
    tokenUsage: {},
  }),
  recordTokenUsage: vi.fn().mockResolvedValue(undefined),
  recordGateResult: vi.fn().mockResolvedValue(undefined),
  setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

// Alias used by notifier integration tests
function makeCheckpoint(overrides: Record<string, unknown> = {}): CheckpointManager {
  return makeCheckpointMock(overrides) as unknown as CheckpointManager;
}

function makeConfig(tokenBudget?: number): CadreConfig {
  return {
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42] },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      dryRun: false,
      resume: false,
      buildVerification: false,
      testVerification: false,
      tokenBudget: tokenBudget ?? undefined,
    },
    commits: {
      commitPerPhase: false,
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: false,
      draft: false,
      linkIssue: false,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
    environment: { inheritShellPath: true, extraPath: [] },
    issueUpdates: {
      enabled: false,
      onStart: false,
      onPhaseComplete: false,
      onComplete: false,
      onFailed: false,
      onBudgetWarning: false,
    },
  } as unknown as CadreConfig;
}

function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test Issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    url: 'https://github.com/owner/repo/issues/42',
  } as unknown as IssueDetail;
}

function makeWorktree(): WorktreeInfo {
  return {
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    baseCommit: 'abc123',
    issueNumber: 42,
  } as unknown as WorktreeInfo;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  } as unknown as Logger;
}

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
  let config: CadreConfig;
  let issue: IssueDetail;
  let worktree: WorktreeInfo;
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
      const nm = { dispatch } as unknown as NotificationManager;

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
      const nm = { dispatch } as unknown as NotificationManager;

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
      const nm = { dispatch } as unknown as NotificationManager;

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
        isPhaseCompleted: vi.fn((phaseId: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('simulated phase failure'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch } as unknown as NotificationManager;

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
        isPhaseCompleted: vi.fn((phaseId: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('phase 1 error'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch } as unknown as NotificationManager;

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
        isPhaseCompleted: vi.fn((phaseId: number) => phaseId !== 1),
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
        isPhaseCompleted: vi.fn((phaseId: number) => phaseId !== 1),
      });
      vi.mocked(fsUtils.ensureDir).mockRejectedValueOnce(new Error('phase 1 error'));
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const nm = { dispatch } as unknown as NotificationManager;

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
      const nm = { dispatch } as unknown as NotificationManager;

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

// ── IssueNotifier integration ──

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
    tempDir = join(tmpdir(), `cadre-notif-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeWorktree(): WorktreeInfo {
    return {
      path: worktreePath,
      branch: 'cadre/issue-42',
      baseCommit: 'abc123',
      issueNumber: 42,
    } as unknown as WorktreeInfo;
  }

  function makeOrchestrator(
    config: CadreConfig,
    checkpoint: CheckpointManager,
    launcher: AgentLauncher,
    logger: Logger,
  ): IssueOrchestrator {
    return new IssueOrchestrator(
      config,
      makeIssue(),
      makeWorktree(),
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

// ── IssueResult codeComplete / prCreated / prFailed ──

describe('IssueOrchestrator – buildResult codeComplete and prCreated', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockNotifierMethods.notifyStart.mockResolvedValue(undefined);
    mockNotifierMethods.notifyPhaseComplete.mockResolvedValue(undefined);
    mockNotifierMethods.notifyComplete.mockResolvedValue(undefined);
    mockNotifierMethods.notifyFailed.mockResolvedValue(undefined);
    mockNotifierMethods.notifyBudgetWarning.mockResolvedValue(undefined);
    tempDir = join(tmpdir(), `cadre-result-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeWorktreeLocal(): WorktreeInfo {
    return {
      path: worktreePath,
      branch: 'cadre/issue-42',
      baseCommit: 'abc123',
      issueNumber: 42,
    } as unknown as WorktreeInfo;
  }

  it('should include codeComplete and prCreated in IssueResult', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result).toHaveProperty('codeComplete');
    expect(result).toHaveProperty('prCreated');
  });

  it('should set codeComplete to true when phases 1-4 all succeed (skipped as pre-completed)', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result.codeComplete).toBe(true);
  });

  it('should set prCreated to false when no PR is created', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => true) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const result = await orchestrator.run();

    expect(result.prCreated).toBe(false);
    expect(result.pr).toBeUndefined();
  });

  it('should set prCreated to true when setPR is called during execution', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const fakePR = {
      number: 77,
      url: 'https://github.com/owner/repo/pull/77',
      title: 'feat: implement changes',
      headBranch: 'cadre/issue-42',
      baseBranch: 'main',
    };

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockImplementation(async (executor: { phaseId: number; name: string }) => {
        if (executor.phaseId === 5) {
          (orchestrator as unknown as { createdPR: typeof fakePR }).createdPR = fakePR;
        }
        return {
          phase: executor.phaseId,
          phaseName: executor.name,
          success: true,
          duration: 10,
          tokenUsage: 0,
          outputPath: '',
        };
      });

    const result = await orchestrator.run();

    expect(result.prCreated).toBe(true);
    expect(result.pr).toEqual(fakePR);
  });

  it('should set codeComplete to false when budget is exceeded', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(100),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockRejectedValue(new BudgetExceededError());

    const result = await orchestrator.run();

    expect(result.codeComplete).toBe(false);
    expect(result.budgetExceeded).toBe(true);
  });

  it('should set codeComplete to false when a critical phase fails before phase 4', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockResolvedValue({
        phase: 1,
        phaseName: 'Analysis & Scouting',
        success: false,
        duration: 10,
        tokenUsage: 0,
        error: 'agent failed',
      });

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.codeComplete).toBe(false);
  });

  it('should set success to true when code is complete and only PR creation failed', async () => {
    const checkpoint = makeCheckpointMock({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktreeLocal(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockImplementation(async (executor: { phaseId: number; name: string }) => ({
        phase: executor.phaseId,
        phaseName: executor.name,
        success: true,
        duration: 10,
        tokenUsage: 0,
        outputPath: '',
      }));

    // Simulate prFailed being set (as would happen when setPRFailed is invoked via ctx)
    (orchestrator as unknown as { prFailed: boolean }).prFailed = true;

    const result = await orchestrator.run();

    // success should be true because codeComplete = true and prFailed = true
    expect(result.success).toBe(true);
    expect(result.codeComplete).toBe(true);
    expect(result.prCreated).toBe(false);
  });
});
