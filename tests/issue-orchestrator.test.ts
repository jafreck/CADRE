import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import * as fsUtils from '../src/util/fs.js';
import { TokenTracker } from '../src/budget/token-tracker.js';
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
    importRecords: vi.fn(),
    getRecords: vi.fn().mockReturnValue([]),
    getByPhase: vi.fn().mockReturnValue({}),
    getSummary: vi.fn().mockReturnValue({ total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 }),
    checkIssueBudget: vi.fn().mockReturnValue('ok'),
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
  getTokenRecords: vi.fn().mockReturnValue([]),
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
    addIssueComment: vi.fn().mockResolvedValue(undefined),
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

describe('IssueOrchestrator – cost report', () => {
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

  it('should write cost-report.json after a successful run', async () => {
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

    await orchestrator.run();

    const expectedPath = `/tmp/worktree-42/.cadre/issues/42/cost-report.json`;
    expect(vi.mocked(fsUtils.atomicWriteJSON)).toHaveBeenCalledWith(
      expectedPath,
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('should write cost-report.json even when a critical phase fails (finally block)', async () => {
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

    // ensureDir is called for the phase AND for cost report; atomicWriteJSON must still be called
    expect(vi.mocked(fsUtils.atomicWriteJSON)).toHaveBeenCalledWith(
      expect.stringContaining('cost-report.json'),
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('should produce a cost report conforming to the CostReport interface', async () => {
    const checkpoint = makeCheckpointMock();

    // Provide a detailed token record (input/output split)
    vi.mocked(TokenTracker).mockImplementationOnce(() => ({
      getTotal: vi.fn().mockReturnValue(1000),
      record: vi.fn(),
      getRecords: vi.fn().mockReturnValue([
        { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 1000, input: 750, output: 250, timestamp: '2024-01-01T00:00:00Z' },
      ]),
      getByPhase: vi.fn().mockReturnValue({ 1: 1000 }),
      getSummary: vi.fn().mockReturnValue({ total: 1000, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 1 }),
      checkIssueBudget: vi.fn().mockReturnValue('ok'),
    }) as never);

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    const writeCall = vi.mocked(fsUtils.atomicWriteJSON).mock.calls.find(
      (args) => String(args[0]).endsWith('cost-report.json'),
    );
    expect(writeCall).toBeDefined();
    const report = writeCall![1] as Record<string, unknown>;
    expect(report).toHaveProperty('issueNumber', 42);
    expect(report).toHaveProperty('totalTokens');
    expect(report).toHaveProperty('estimatedCost');
    expect(report).toHaveProperty('byAgent');
    expect(report).toHaveProperty('byPhase');
    expect(report).toHaveProperty('model');
    expect(report).toHaveProperty('generatedAt');
    expect(Array.isArray(report.byAgent)).toBe(true);
    expect(Array.isArray(report.byPhase)).toBe(true);
  });

  it('should call addIssueComment when postCostComment is true', async () => {
    const checkpoint = makeCheckpointMock();
    (config.options as Record<string, unknown>).postCostComment = true;

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    expect(platform.addIssueComment).toHaveBeenCalledOnce();
    expect(platform.addIssueComment).toHaveBeenCalledWith(42, expect.stringContaining('Cost Report'));
  });

  it('should NOT call addIssueComment when postCostComment is false (default)', async () => {
    const checkpoint = makeCheckpointMock();
    // postCostComment is not set in makeConfig(), so it defaults to falsy

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    expect(platform.addIssueComment).not.toHaveBeenCalled();
  });

  it('should use estimateDetailed when token records have input/output split', async () => {
    const checkpoint = makeCheckpointMock();

    vi.mocked(TokenTracker).mockImplementationOnce(() => ({
      getTotal: vi.fn().mockReturnValue(2000),
      record: vi.fn(),
      getRecords: vi.fn().mockReturnValue([
        { issueNumber: 42, agent: 'test-agent', phase: 1, tokens: 2000, input: 1500, output: 500, timestamp: '2024-01-01T00:00:00Z' },
      ]),
      getByPhase: vi.fn().mockReturnValue({ 1: 2000 }),
      getSummary: vi.fn().mockReturnValue({ total: 2000, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 1 }),
      checkIssueBudget: vi.fn().mockReturnValue('ok'),
    }) as never);

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    const writeCall = vi.mocked(fsUtils.atomicWriteJSON).mock.calls.find(
      (args) => String(args[0]).endsWith('cost-report.json'),
    );
    const report = writeCall![1] as Record<string, unknown>;
    // With detailed records: totalTokens = input + output = 1500 + 500 = 2000
    expect(report.totalTokens).toBe(2000);
    expect(report.inputTokens).toBe(1500);
    expect(report.outputTokens).toBe(500);
  });

  it('should fall back to estimate when token records have no input/output split', async () => {
    const checkpoint = makeCheckpointMock();

    vi.mocked(TokenTracker).mockImplementationOnce(() => ({
      getTotal: vi.fn().mockReturnValue(4000),
      record: vi.fn(),
      getRecords: vi.fn().mockReturnValue([
        { issueNumber: 42, agent: 'test-agent', phase: 1, tokens: 4000, timestamp: '2024-01-01T00:00:00Z' },
      ]),
      getByPhase: vi.fn().mockReturnValue({ 1: 4000 }),
      getSummary: vi.fn().mockReturnValue({ total: 4000, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 1 }),
      checkIssueBudget: vi.fn().mockReturnValue('ok'),
    }) as never);

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    const writeCall = vi.mocked(fsUtils.atomicWriteJSON).mock.calls.find(
      (args) => String(args[0]).endsWith('cost-report.json'),
    );
    const report = writeCall![1] as Record<string, unknown>;
    // Without detailed records: falls back to estimate with 3:1 input/output ratio
    expect(report.totalTokens).toBe(4000);
    expect(report.inputTokens).toBe(3000); // 75% of 4000
    expect(report.outputTokens).toBe(1000); // 25% of 4000
  });

  it('should include agent and phase breakdowns in byAgent and byPhase', async () => {
    const checkpoint = makeCheckpointMock();

    vi.mocked(TokenTracker).mockImplementationOnce(() => ({
      getTotal: vi.fn().mockReturnValue(1500),
      record: vi.fn(),
      getRecords: vi.fn().mockReturnValue([
        { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 1000, input: 750, output: 250, timestamp: '2024-01-01T00:00:00Z' },
        { issueNumber: 42, agent: 'codebase-scout', phase: 1, tokens: 500, input: 375, output: 125, timestamp: '2024-01-01T00:00:01Z' },
      ]),
      getByPhase: vi.fn().mockReturnValue({ 1: 1500 }),
      getSummary: vi.fn().mockReturnValue({ total: 1500, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 2 }),
      checkIssueBudget: vi.fn().mockReturnValue('ok'),
    }) as never);

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    const writeCall = vi.mocked(fsUtils.atomicWriteJSON).mock.calls.find(
      (args) => String(args[0]).endsWith('cost-report.json'),
    );
    const report = writeCall![1] as { byAgent: Array<{ agent: string }>; byPhase: Array<{ phase: number }> };

    expect(report.byAgent).toHaveLength(2);
    expect(report.byAgent.map((e) => e.agent)).toContain('issue-analyst');
    expect(report.byAgent.map((e) => e.agent)).toContain('codebase-scout');
    expect(report.byPhase).toHaveLength(1);
    expect(report.byPhase[0].phase).toBe(1);
  });

  it('formatCostComment should produce markdown with cost summary sections', async () => {
    const checkpoint = makeCheckpointMock();
    (config.options as Record<string, unknown>).postCostComment = true;

    vi.mocked(TokenTracker).mockImplementationOnce(() => ({
      getTotal: vi.fn().mockReturnValue(500),
      record: vi.fn(),
      getRecords: vi.fn().mockReturnValue([
        { issueNumber: 42, agent: 'pr-composer', phase: 5, tokens: 500, input: 375, output: 125, timestamp: '2024-01-01T00:00:00Z' },
      ]),
      getByPhase: vi.fn().mockReturnValue({ 5: 500 }),
      getSummary: vi.fn().mockReturnValue({ total: 500, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 1 }),
      checkIssueBudget: vi.fn().mockReturnValue('ok'),
    }) as never);

    const orchestrator = new IssueOrchestrator(
      config,
      issue,
      worktree,
      checkpoint as never,
      launcher as never,
      platform as never,
      logger,
    );

    await orchestrator.run();

    const commentArg = vi.mocked(platform.addIssueComment).mock.calls[0]?.[1] as string;
    expect(commentArg).toContain('Cost Report for Issue #42');
    expect(commentArg).toContain('By Agent');
    expect(commentArg).toContain('By Phase');
    expect(commentArg).toContain('pr-composer');
    expect(commentArg).toMatch(/\$\d+\.\d+/); // contains a cost value
  });
});
