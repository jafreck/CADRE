import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider, IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { Logger } from '../src/logging/logger.js';

// ── Hoisted mock functions ────────────────────────────────────────────────────

const {
  mockProgressAppendEvent,
  mockProgressWrite,
  mockContextBuildForCodeWriter,
  mockContextBuildForTestWriter,
  mockContextBuildForCodeReviewer,
  mockContextBuildForFixSurgeon,
  mockContextBuildForImplementationPlanner,
  mockContextBuildForIssueAnalyst,
  mockContextBuildForCodebaseScout,
  mockContextBuildForPRComposer,
  mockCommitGetChangedFiles,
  mockCommitGetDiff,
  mockCommitIsClean,
  mockCommitCommit,
  mockCommitPush,
  mockCommitSquash,
  mockCommitStripCadreFiles,
  mockResultParserParsePlan,
  mockResultParserParseReview,
  mockRetryExecutorExecute,
  mockTokenTrackerGetTotal,
  mockEnsureDir,
  mockAtomicWriteJSON,
  mockListFilesRecursive,
  mockExists,
  mockExecShell,
  mockFsWriteFile,
  mockIsComplete,
  mockGetReady,
  mockSelectNonOverlappingBatch,
  mockAnalysisGateValidate,
  mockPlanningGateValidate,
  mockImplGateValidate,
  mockIntegrationGateValidate,
} = vi.hoisted(() => ({
  mockProgressAppendEvent: vi.fn().mockResolvedValue(undefined),
  mockProgressWrite: vi.fn().mockResolvedValue(undefined),
  mockContextBuildForCodeWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForTestWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForCodeReviewer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForFixSurgeon: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForImplementationPlanner: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForIssueAnalyst: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForCodebaseScout: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForPRComposer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockCommitGetChangedFiles: vi.fn().mockResolvedValue([]),
  mockCommitGetDiff: vi.fn().mockResolvedValue(''),
  mockCommitIsClean: vi.fn().mockResolvedValue(true),
  mockCommitCommit: vi.fn().mockResolvedValue(undefined),
  mockCommitPush: vi.fn().mockResolvedValue(undefined),
  mockCommitSquash: vi.fn().mockResolvedValue(undefined),
  mockCommitStripCadreFiles: vi.fn().mockResolvedValue(undefined),
  mockResultParserParsePlan: vi.fn().mockResolvedValue([]),
  mockResultParserParseReview: vi.fn(),
  mockRetryExecutorExecute: vi.fn(),
  mockTokenTrackerGetTotal: vi.fn().mockReturnValue(0),
  mockEnsureDir: vi.fn().mockResolvedValue(undefined),
  mockAtomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  mockListFilesRecursive: vi.fn().mockResolvedValue(['src/index.ts']),
  mockExists: vi.fn().mockResolvedValue(false),
  mockExecShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockIsComplete: vi.fn(),
  mockGetReady: vi.fn(),
  mockSelectNonOverlappingBatch: vi.fn(),
  mockAnalysisGateValidate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }),
  mockPlanningGateValidate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }),
  mockImplGateValidate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }),
  mockIntegrationGateValidate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/core/phase-gate.js', () => ({
  AnalysisToPlanningGate: vi.fn(() => ({ validate: mockAnalysisGateValidate })),
  PlanningToImplementationGate: vi.fn(() => ({ validate: mockPlanningGateValidate })),
  ImplementationToIntegrationGate: vi.fn(() => ({ validate: mockImplGateValidate })),
  IntegrationToPRGate: vi.fn(() => ({ validate: mockIntegrationGateValidate })),
}));

vi.mock('../src/core/progress.js', () => ({
  IssueProgressWriter: vi.fn(() => ({
    appendEvent: mockProgressAppendEvent,
    write: mockProgressWrite,
  })),
}));

vi.mock('../src/agents/context-builder.js', () => ({
  ContextBuilder: vi.fn(() => ({
    buildForIssueAnalyst: mockContextBuildForIssueAnalyst,
    buildForCodebaseScout: mockContextBuildForCodebaseScout,
    buildForImplementationPlanner: mockContextBuildForImplementationPlanner,
    buildForCodeWriter: mockContextBuildForCodeWriter,
    buildForTestWriter: mockContextBuildForTestWriter,
    buildForCodeReviewer: mockContextBuildForCodeReviewer,
    buildForFixSurgeon: mockContextBuildForFixSurgeon,
    buildForPRComposer: mockContextBuildForPRComposer,
  })),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn(() => ({
    parseImplementationPlan: mockResultParserParsePlan,
    parseReview: mockResultParserParseReview,
    parsePRContent: vi.fn().mockResolvedValue({ title: 'PR', body: '', labels: [] }),
  })),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn(() => ({
    isClean: mockCommitIsClean,
    getChangedFiles: mockCommitGetChangedFiles,
    getDiff: mockCommitGetDiff,
    getTaskDiff: mockCommitGetDiff,
    commit: mockCommitCommit,
    push: mockCommitPush,
    squash: mockCommitSquash,
    stripCadreFiles: mockCommitStripCadreFiles,
  })),
}));

vi.mock('../src/execution/retry.js', () => ({
  RetryExecutor: vi.fn(() => ({
    execute: mockRetryExecutorExecute,
  })),
}));

vi.mock('../src/execution/task-queue.js', () => {
  // selectNonOverlappingBatch is a static method on the TaskQueue class, so it must be
  // attached to the mock constructor function itself (not as a module-level export).
  const QueueFactory = vi.fn(() => ({
    topologicalSort: vi.fn().mockReturnValue([]),
    isComplete: mockIsComplete,
    getReady: mockGetReady,
    getCounts: vi.fn().mockReturnValue({ total: 1, completed: 0, blocked: 0 }),
    restoreState: vi.fn(),
    start: vi.fn(),
    complete: vi.fn(),
    markBlocked: vi.fn(),
  }));
  const TaskQueueMock = Object.assign(QueueFactory, { selectNonOverlappingBatch: mockSelectNonOverlappingBatch });
  const SessionQueueMock = Object.assign(vi.fn(() => ({
    topologicalSort: vi.fn().mockReturnValue([]),
    isComplete: mockIsComplete,
    getReady: mockGetReady,
    getCounts: vi.fn().mockReturnValue({ total: 1, completed: 0, blocked: 0 }),
    restoreState: vi.fn(),
    start: vi.fn(),
    complete: vi.fn(),
    markBlocked: vi.fn(),
  })), { selectNonOverlappingBatch: mockSelectNonOverlappingBatch });
  return { TaskQueue: TaskQueueMock, SessionQueue: SessionQueueMock };
});

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn(() => ({
    record: vi.fn(),
    getTotal: mockTokenTrackerGetTotal,
    checkIssueBudget: vi.fn().mockReturnValue('ok'),
    getSummary: vi.fn().mockReturnValue({}),
    exportRecords: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../src/util/fs.js', () => ({
  ensureDir: mockEnsureDir,
  atomicWriteJSON: mockAtomicWriteJSON,
  exists: mockExists,
  listFilesRecursive: mockListFilesRecursive,
  readJSON: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/util/process.js', () => ({
  execShell: mockExecShell,
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockFsWriteFile,
  readFile: vi.fn().mockResolvedValue(''),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig() {
  return makeRuntimeConfig({
    projectName: 'test',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [42] },
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: false,
      draft: true,
      labels: [],
      reviewers: [],
      linkIssue: false,
    },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
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
    copilot: { cliCommand: 'copilot', agentDir: '.agents', timeout: 300000, model: 'claude-sonnet-4.6' },
  });
}

function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test Issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    linkedPRs: [],
  } as unknown as IssueDetail;
}

function makeWorktree(): WorktreeInfo {
  return {
    issueNumber: 42,
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    exists: true,
    baseCommit: 'abc123',
  } as unknown as WorktreeInfo;
}

function makeMockCheckpoint(completedPhaseIds: number[] = []): CheckpointManager {
  return {
    load: vi.fn().mockResolvedValue({}),
    getState: vi.fn().mockReturnValue({
      issueNumber: 42,
      currentPhase: 1,
      completedPhases: completedPhaseIds,
      completedTasks: [],
      blockedTasks: [],
      failedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '/tmp/worktree-42',
      branchName: 'cadre/issue-42',
      baseCommit: 'abc123',
    }),
    getResumePoint: vi.fn().mockReturnValue({ phase: 1, task: null }),
    isPhaseCompleted: vi.fn().mockImplementation((phaseId: number) =>
      completedPhaseIds.includes(phaseId),
    ),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
    isTaskCompleted: vi.fn().mockReturnValue(false),
    startTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    failTask: vi.fn().mockResolvedValue(undefined),
    blockTask: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    recordGateResult: vi.fn().mockResolvedValue(undefined),
    startSubTask: vi.fn().mockResolvedValue(undefined),
    ...(() => {
      const completedSubTasks = new Set<string>();
      return {
        completeSubTask: vi.fn(async (id: string) => { completedSubTasks.add(id); }),
        isSubTaskCompleted: vi.fn((id: string) => completedSubTasks.has(id)),
      };
    })(),
  } as unknown as CheckpointManager;
}

function makeMockLauncher(): AgentLauncher {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    launchAgent: vi.fn().mockResolvedValue({
      agent: 'code-writer',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      stdout: '',
      stderr: '',
      tokenUsage: 0,
      outputPath: '',
      outputExists: true,
    }),
  } as unknown as AgentLauncher;
}

function makeMockPlatform(): PlatformProvider {
  return {
    name: 'GitHub',
    createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' }),
    issueLinkSuffix: vi.fn().mockReturnValue(''),
  } as unknown as PlatformProvider;
}

function makeMockLogger(): Logger {
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

/** Single session returned from parseImplementationPlan */
const SAMPLE_TASK = {
  id: 'session-001',
  name: 'Fix login handler',
  rationale: 'Implement timeout handling',
  dependencies: [],
  steps: [{
    id: 'session-001-step-001',
    name: 'Fix login handler step',
    description: 'Implement timeout handling',
    files: ['src/auth/login.ts'],
    complexity: 'simple' as const,
    acceptanceCriteria: ['Timeout works'],
  }],
};

/**
 * Configures the retry executor mock to actually invoke `fn` and propagate errors.
 * This allows us to exercise the ZodError catch block inside executeTask.
 */
function configureRetryExecutorPassthrough() {
  mockRetryExecutorExecute.mockImplementation(
    async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    },
  );
}

/**
 * Configures the task queue to run a single iteration with SAMPLE_TASK,
 * then report complete.
 */
function configureTaskQueueWithOneTask() {
  mockIsComplete.mockReturnValueOnce(false).mockReturnValue(true);
  mockGetReady.mockReturnValue([SAMPLE_TASK]);
  mockSelectNonOverlappingBatch.mockReturnValue([SAMPLE_TASK]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IssueOrchestrator – ZodError retry handling in executeTask', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeMockLogger();

    // Gates all pass by default
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockPlanningGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockImplGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockIntegrationGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
  });

  it('should log a warn with formatted ZodError message when parseReview throws ZodError', async () => {
    // Arrange: phase 3 runs (phases 1, 2, 4, 5 pre-completed)
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    configureRetryExecutorPassthrough();
    configureTaskQueueWithOneTask();

    // parseImplementationPlan returns one task
    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);

    // The review file exists so parseReview is called
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));

    // parseReview throws a ZodError with a specific field error
    const zodError = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['verdict'], message: 'Required' },
    ]);
    mockResultParserParseReview.mockRejectedValue(zodError);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    // Assert: logger.warn was called with the ZodError-formatted message
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(warnCalls.some((m: string) => m.includes('validation failed') && m.includes('will retry'))).toBe(true);
  });

  it('should include the field path and message from ZodError in the warn log', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    configureRetryExecutorPassthrough();
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));

    const zodError = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['verdict'], message: 'Required' },
    ]);
    mockResultParserParseReview.mockRejectedValue(zodError);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    const validationWarn = warnCalls.find((m: string) => m.includes('validation failed'));
    expect(validationWarn).toBeDefined();
    // The formatted message should contain "verdict: Required"
    expect(validationWarn).toContain('verdict');
    expect(validationWarn).toContain('Required');
  });

  it('should include taskId in the warn log metadata when parseReview throws ZodError', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    configureRetryExecutorPassthrough();
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));

    const zodError = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['summary'], message: 'Required' },
    ]);
    mockResultParserParseReview.mockRejectedValue(zodError);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [string]) => msg.includes('validation failed'),
    );
    expect(warnCall).toBeDefined();
    // Second arg is the metadata object – should contain taskId
    const meta = warnCall?.[1] as Record<string, unknown>;
    expect(meta).toHaveProperty('sessionId', 'session-001');
  });

  it('should NOT call logger.warn with validation message when parseReview throws a non-ZodError', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    configureRetryExecutorPassthrough();
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));

    // A plain error – should NOT trigger the ZodError warn path
    mockResultParserParseReview.mockRejectedValue(new Error('disk read failure'));

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(warnCalls.some((m: string) => m.includes('validation failed'))).toBe(false);
  });

  it('should re-throw ZodError so the retry executor records a failure attempt', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);

    // Track whether fn threw
    let capturedError: unknown;
    mockRetryExecutorExecute.mockImplementation(
      async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
        try {
          await fn(1);
          return { success: true, result: true, attempts: 1, recoveryUsed: false };
        } catch (err) {
          capturedError = err;
          return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
        }
      },
    );
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));

    const zodError = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['verdict'], message: 'Required' },
    ]);
    mockResultParserParseReview.mockRejectedValue(zodError);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    // The error captured by the retry executor should be the original ZodError
    expect(capturedError).toBeInstanceOf(ZodError);
  });

  it('should re-throw non-ZodError unchanged so retry executor captures it', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);

    const originalError = new TypeError('unexpected null');
    let capturedError: unknown;
    mockRetryExecutorExecute.mockImplementation(
      async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
        try {
          await fn(1);
          return { success: true, result: true, attempts: 1, recoveryUsed: false };
        } catch (err) {
          capturedError = err;
          return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
        }
      },
    );
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    mockExists.mockImplementation((path: string) => Promise.resolve(path.includes('review-')));
    mockResultParserParseReview.mockRejectedValue(originalError);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    expect(capturedError).toBe(originalError);
  });

  it('should not call parseReview at all when the review file does not exist', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    configureRetryExecutorPassthrough();
    configureTaskQueueWithOneTask();

    mockResultParserParsePlan.mockResolvedValue([SAMPLE_TASK]);
    // Review file does not exist
    mockExists.mockResolvedValue(false);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      logger,
    );

    await orchestrator.run();

    expect(mockResultParserParseReview).not.toHaveBeenCalled();
  });
});
