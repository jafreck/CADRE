import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import { FleetCheckpointManager } from '../src/core/checkpoint.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { Logger } from '../src/logging/logger.js';

// ── IssueOrchestrator mocks ──
vi.mock('../src/core/issue-notifier.js', () => ({
  IssueNotifier: vi.fn().mockImplementation(() => ({
    notifyStart: vi.fn().mockResolvedValue(undefined),
    notifyPhaseComplete: vi.fn().mockResolvedValue(undefined),
    notifyComplete: vi.fn().mockResolvedValue(undefined),
    notifyFailed: vi.fn().mockResolvedValue(undefined),
    notifyBudgetWarning: vi.fn().mockResolvedValue(undefined),
  })),
}));

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

vi.mock('../src/core/progress.js', () => ({
  IssueProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  })),
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    write: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
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
  return { ...actual, writeFile: vi.fn().mockResolvedValue(undefined) };
});

// ── FleetOrchestrator mocks ──
vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn(),
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
    isIssueCompleted: vi.fn().mockReturnValue(false),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    getIssueStatus: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn().mockReturnValue(5),
}));

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

// ── Shared helpers ──

function makeIssueOrchestratorCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
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
  };
}

function makeConfig(): CadreConfig {
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
    },
    commits: { commitPerPhase: false, squashBeforePR: false },
    pullRequest: { autoCreate: false, draft: false, linkIssue: false },
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

function makeFleetConfig(overrides: Partial<CadreConfig['options']> = {}): CadreConfig {
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
      ...overrides,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4', agentDir: '.github/agents', timeout: 300000, costOverrides: {} },
    notifications: { enabled: false, providers: [] },
  } as unknown as CadreConfig;
}

function makeIssue(number = 42): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: 'body',
    labels: [],
    assignees: [],
    url: `https://github.com/owner/repo/issues/${number}`,
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

function makeFleetDeps() {
  const worktreeManager = {
    provision: vi.fn().mockResolvedValue({
      path: '/tmp/worktree/1',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
    }),
  };
  const launcher = {};
  const platform = {};
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { worktreeManager, launcher, platform, logger };
}

// ── Tests ──

describe('PR failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PR creation failure → codeComplete true, prCreated false, not in prsCreated', async () => {
    const checkpoint = makeIssueOrchestratorCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    // Phases 1-4 succeed; phase 5 also returns success but prFailed is set (as the real phase executor would do)
    vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
      .mockImplementation(async (executor: { phaseId: number; name: string }) => ({
        phase: executor.phaseId,
        phaseName: executor.name,
        success: true,
        duration: 10,
        tokenUsage: 0,
        outputPath: '',
      }));

    // Simulate PR creation failure (prFailed=true, no createdPR)
    (orchestrator as unknown as { prFailed: boolean }).prFailed = true;

    const result = await orchestrator.run();

    expect(result.codeComplete).toBe(true);
    expect(result.prCreated).toBe(false);
    expect(result.success).toBe(true);
    expect(result.pr).toBeUndefined();
  });

  it('PR creation success → prCreated true, appears in prsCreated', async () => {
    const checkpoint = makeIssueOrchestratorCheckpoint({ isPhaseCompleted: vi.fn(() => false) });
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint as never,
      makeLauncher() as never,
      makePlatform() as never,
      makeLogger(),
    );

    const fakePR = {
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
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
    expect(result.codeComplete).toBe(true);
    expect(result.success).toBe(true);
  });

  describe('codeDoneNoPR aggregation in FleetResult', () => {
    it('places codeComplete+!prCreated issue into codeDoneNoPR, not prsCreated or failedIssues', async () => {
      const { IssueOrchestrator: MockIssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      (MockIssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: false,
          pr: undefined,
          phases: [],
          totalDuration: 100,
          tokenUsage: 500,
        }),
      }));

      const config = makeFleetConfig();
      const issues = [makeIssue(1)];
      const { worktreeManager, launcher, platform, logger } = makeFleetDeps();
      const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;

      const fleet = new FleetOrchestrator(
        config, issues,
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      const result = await fleet.run();

      expect(result.codeDoneNoPR).toHaveLength(1);
      expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 1, issueTitle: 'Issue 1' });
      expect(result.prsCreated).toHaveLength(0);
      expect(result.failedIssues).toHaveLength(0);
    });

    it('sets fleet checkpoint status to code-complete-no-pr for codeComplete+!prCreated issues', async () => {
      const { IssueOrchestrator: MockIssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      (MockIssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: false,
          pr: undefined,
          phases: [1],
          totalDuration: 100,
          tokenUsage: 500,
        }),
      }));

      const config = makeFleetConfig();
      const issues = [makeIssue(1)];
      const { worktreeManager, launcher, platform, logger } = makeFleetDeps();
      const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;

      const fleet = new FleetOrchestrator(
        config, issues,
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const checkpointInstance = (FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const statusCalls = checkpointInstance.setIssueStatus.mock.calls as unknown[][];
      const terminalCall = statusCalls.find((args) => args[1] !== 'in-progress');
      expect(terminalCall).toBeDefined();
      expect(terminalCall![1]).toBe('code-complete-no-pr');
    });
  });
});
