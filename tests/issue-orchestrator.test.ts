import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import * as fsUtils from '../src/util/fs.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { Logger } from '../src/logging/logger.js';

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

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

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
  setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

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
      tokenBudget: undefined,
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
