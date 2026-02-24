import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider } from '../src/platform/provider.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';

// ── Module-level mock functions (hoisted so vi.mock factories can reference them) ──

const {
  mockAnalysisGateValidate,
  mockPlanningGateValidate,
  mockImplGateValidate,
  mockIntegrationGateValidate,
  mockProgressAppendEvent,
  mockProgressWrite,
  mockContextBuildForIssueAnalyst,
  mockContextBuildForCodebaseScout,
  mockContextBuildForImplementationPlanner,
  mockContextBuildForCodeWriter,
  mockContextBuildForTestWriter,
  mockContextBuildForCodeReviewer,
  mockContextBuildForFixSurgeon,
  mockContextBuildForPRComposer,
  mockCommitIsClean,
  mockCommitGetChangedFiles,
  mockCommitGetDiff,
  mockCommitCommit,
  mockCommitPush,
  mockCommitSquash,
  mockResultParserParsePlan,
  mockRetryExecutorExecute,
  mockTokenTrackerGetTotal,
  mockEnsureDir,
  mockAtomicWriteJSON,
  mockListFilesRecursive,
  mockExists,
  mockExecShell,
  mockFsWriteFile,
  mockFsReadFile,
  mockNotifyAmbiguities,
} = vi.hoisted(() => ({
  mockAnalysisGateValidate: vi.fn(),
  mockPlanningGateValidate: vi.fn(),
  mockImplGateValidate: vi.fn(),
  mockIntegrationGateValidate: vi.fn(),
  mockProgressAppendEvent: vi.fn().mockResolvedValue(undefined),
  mockProgressWrite: vi.fn().mockResolvedValue(undefined),
  mockContextBuildForIssueAnalyst: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForCodebaseScout: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForImplementationPlanner: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForCodeWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForTestWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForCodeReviewer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForFixSurgeon: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockContextBuildForPRComposer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  mockCommitIsClean: vi.fn().mockResolvedValue(true),
  mockCommitGetChangedFiles: vi.fn().mockResolvedValue([]),
  mockCommitGetDiff: vi.fn().mockResolvedValue(''),
  mockCommitCommit: vi.fn().mockResolvedValue(undefined),
  mockCommitPush: vi.fn().mockResolvedValue(undefined),
  mockCommitSquash: vi.fn().mockResolvedValue(undefined),
  mockResultParserParsePlan: vi.fn().mockResolvedValue([]),
  mockRetryExecutorExecute: vi.fn(),
  mockTokenTrackerGetTotal: vi.fn().mockReturnValue(0),
  mockEnsureDir: vi.fn().mockResolvedValue(undefined),
  mockAtomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  mockListFilesRecursive: vi.fn().mockResolvedValue(['src/index.ts']),
  mockExists: vi.fn().mockResolvedValue(false),
  mockExecShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsReadFile: vi.fn().mockResolvedValue(''),
  mockNotifyAmbiguities: vi.fn().mockResolvedValue(undefined),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/core/issue-notifier.js', () => ({
  IssueNotifier: vi.fn().mockImplementation(() => {
    const methods = {
      notifyStart: vi.fn().mockResolvedValue(undefined),
      notifyPhaseComplete: vi.fn().mockResolvedValue(undefined),
      notifyComplete: vi.fn().mockResolvedValue(undefined),
      notifyFailed: vi.fn().mockResolvedValue(undefined),
      notifyBudgetWarning: vi.fn().mockResolvedValue(undefined),
      notifyAmbiguities: mockNotifyAmbiguities,
      notify: vi.fn().mockImplementation(async (event: any) => {
        if (event.type === 'ambiguity-detected') return mockNotifyAmbiguities(event.issueNumber, event.ambiguities);
      }),
    };
    return methods;
  }),
}));

vi.mock('../src/core/phase-gate.js', () => ({
  AnalysisToPlanningGate: vi.fn(() => ({ validate: mockAnalysisGateValidate })),
  PlanningToImplementationGate: vi.fn(() => ({ validate: mockPlanningGateValidate })),
  ImplementationToIntegrationGate: vi.fn(() => ({ validate: mockImplGateValidate })),
  IntegrationToPRGate: vi.fn(() => ({ validate: mockIntegrationGateValidate })),
  AnalysisAmbiguityGate: vi.fn(() => ({ validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })) })),
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
    parseReview: vi.fn().mockResolvedValue({ verdict: 'pass', issues: [], summary: '' }),
    parsePRContent: vi.fn().mockResolvedValue({ title: 'PR', body: '', labels: [] }),
  })),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn(() => ({
    isClean: mockCommitIsClean,
    getChangedFiles: mockCommitGetChangedFiles,
    getDiff: mockCommitGetDiff,
    commit: mockCommitCommit,
    push: mockCommitPush,
    squash: mockCommitSquash,
  })),
}));

vi.mock('../src/execution/retry.js', () => ({
  RetryExecutor: vi.fn(() => ({
    execute: mockRetryExecutorExecute,
  })),
}));

vi.mock('../src/execution/task-queue.js', () => ({
  TaskQueue: vi.fn(() => ({
    topologicalSort: vi.fn().mockReturnValue([]),
    isComplete: vi.fn().mockReturnValue(true),
    getReady: vi.fn().mockReturnValue([]),
    getCounts: vi.fn().mockReturnValue({ total: 0, completed: 0, blocked: 0 }),
    restoreState: vi.fn(),
  })),
  // static method:
  selectNonOverlappingBatch: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn(() => ({
    record: vi.fn(),
    getTotal: mockTokenTrackerGetTotal,
    checkIssueBudget: vi.fn().mockReturnValue('ok'),
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
  readFile: mockFsReadFile,
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
      commitPerPhase: false, // disable per-phase commits to keep tests minimal
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: false, // disable so we don't need platform mock for PR
      draft: true,
      labels: [],
      reviewers: [],
      linkIssue: false,
    },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
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
  };
}

function makeWorktree(): WorktreeInfo {
  return {
    issueNumber: 42,
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    exists: true,
    baseCommit: 'abc123',
  };
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
  } as unknown as CheckpointManager;
}

/** Returns a successful AgentResult-like object wrapped in RetryResult format. */
function makeSuccessRetryResult() {
  return {
    success: true,
    result: {
      agent: 'issue-analyst',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      stdout: '',
      stderr: '',
      tokenUsage: 0,
      outputPath: '',
      outputExists: true,
    },
    attempts: 1,
    recoveryUsed: false,
  };
}

function makeMockLauncher(): AgentLauncher {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    launchAgent: vi.fn().mockResolvedValue({
      agent: 'issue-analyst',
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

function makeOrchestrator(
  checkpoint: CheckpointManager,
  launcher: AgentLauncher = makeMockLauncher(),
) {
  return new IssueOrchestrator(
    makeConfig(),
    makeIssue(),
    makeWorktree(),
    checkpoint,
    launcher,
    makeMockPlatform(),
    {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IssueOrchestrator – Gate Validation (runGate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: retryExecutor.execute calls fn once and returns its result
    mockRetryExecutorExecute.mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<any> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    });

    // Default gate results: pass for all gates
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockPlanningGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockImplGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockIntegrationGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    // Default: analysis.md has no ambiguities
    mockFsReadFile.mockResolvedValue('');
  });

  // ── runGate called for correct phases ──────────────────────────────────────

  it('should call the AnalysisToPlanningGate after phase 1 succeeds', async () => {
    // Only phase 1 executes; all others are marked as completed
    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockAnalysisGateValidate).toHaveBeenCalledTimes(1);
    expect(mockPlanningGateValidate).not.toHaveBeenCalled();
    expect(mockImplGateValidate).not.toHaveBeenCalled();
    expect(mockIntegrationGateValidate).not.toHaveBeenCalled();
  });

  it('should call the PlanningToImplementationGate after phase 2 succeeds', async () => {
    // Phase 2 (executePlanning) validates the plan and requires at least one task
    mockResultParserParsePlan.mockResolvedValue([
      {
        id: 'task-001',
        name: 'Task 1',
        description: 'Do something',
        files: ['src/foo.ts'],
        dependencies: [],
        complexity: 'simple',
        acceptanceCriteria: ['It works'],
      },
    ]);

    const checkpoint = makeMockCheckpoint([1, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockPlanningGateValidate).toHaveBeenCalledTimes(1);
    expect(mockAnalysisGateValidate).not.toHaveBeenCalled();
  });

  it('should call ImplementationToIntegrationGate after phase 3 succeeds', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockImplGateValidate).toHaveBeenCalledTimes(1);
  });

  it('should call IntegrationToPRGate after phase 4 succeeds', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 3, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockIntegrationGateValidate).toHaveBeenCalledTimes(1);
  });

  it('should NOT call any gate after phase 5 (no gate for last phase)', async () => {
    const checkpoint = makeMockCheckpoint([1, 2, 3, 4]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    // Phase 5 has no gate — all gate mocks should remain uncalled
    expect(mockAnalysisGateValidate).not.toHaveBeenCalled();
    expect(mockPlanningGateValidate).not.toHaveBeenCalled();
    expect(mockImplGateValidate).not.toHaveBeenCalled();
    expect(mockIntegrationGateValidate).not.toHaveBeenCalled();
  });

  // ── Gate `pass` behaviour ──────────────────────────────────────────────────

  it('should return success and NOT retry when gate passes after phase 1', async () => {
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(mockAnalysisGateValidate).toHaveBeenCalledTimes(1);
  });

  it('should save gate result to checkpoint when gate passes', async () => {
    const gateResult = { status: 'pass' as const, warnings: [], errors: [] };
    mockAnalysisGateValidate.mockResolvedValue(gateResult);

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(checkpoint.recordGateResult).toHaveBeenCalledWith(1, gateResult);
  });

  it('should append a "passed" event to progress log when gate passes', async () => {
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const appendCalls = (mockProgressAppendEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(appendCalls.some((m: string) => m.includes('Gate phase 1') && m.includes('passed'))).toBe(true);
  });

  // ── Gate `warn` behaviour ──────────────────────────────────────────────────

  it('should continue the pipeline when gate returns warn', async () => {
    mockAnalysisGateValidate.mockResolvedValue({
      status: 'warn',
      warnings: ['low test coverage'],
      errors: [],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    // Gate only called once — no retry triggered
    expect(mockAnalysisGateValidate).toHaveBeenCalledTimes(1);
  });

  it('should log each warning message when gate returns warn', async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockAnalysisGateValidate.mockResolvedValue({
      status: 'warn',
      warnings: ['missing integration test', 'coverage below 80%'],
      errors: [],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      mockLogger as any,
    );

    await orchestrator.run();

    const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(warnCalls.some((m: string) => m.includes('missing integration test'))).toBe(true);
    expect(warnCalls.some((m: string) => m.includes('coverage below 80%'))).toBe(true);
  });

  it('should append a "warning" event to progress log when gate returns warn', async () => {
    mockAnalysisGateValidate.mockResolvedValue({
      status: 'warn',
      warnings: ['low coverage'],
      errors: [],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const appendCalls = (mockProgressAppendEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(appendCalls.some((m: string) => m.includes('warning'))).toBe(true);
  });

  it('should save warn gate result to checkpoint', async () => {
    const gateResult = { status: 'warn' as const, warnings: ['slow test'], errors: [] };
    mockAnalysisGateValidate.mockResolvedValue(gateResult);

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(checkpoint.recordGateResult).toHaveBeenCalledWith(1, gateResult);
  });

  // ── Gate `fail` behaviour — retry succeeds ────────────────────────────────

  it('should retry phase 1 when gate fails on the first attempt', async () => {
    // First gate call: fail. Second (after retry): pass.
    mockAnalysisGateValidate
      .mockResolvedValueOnce({ status: 'fail', warnings: [], errors: ['no scout files'] })
      .mockResolvedValueOnce({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(mockAnalysisGateValidate).toHaveBeenCalledTimes(2);
  });

  it('should append a "gate failed; retrying" event when gate fails', async () => {
    mockAnalysisGateValidate
      .mockResolvedValueOnce({ status: 'fail', warnings: [], errors: ['bad output'] })
      .mockResolvedValueOnce({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const appendCalls = (mockProgressAppendEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(appendCalls.some((m: string) => m.toLowerCase().includes('gate failed') && m.includes('retry'))).toBe(true);
  });

  it('should log each error message when gate fails', async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockAnalysisGateValidate
      .mockResolvedValueOnce({
        status: 'fail',
        warnings: [],
        errors: ['missing requirements section', 'no scope defined'],
      })
      .mockResolvedValueOnce({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      mockLogger as any,
    );

    await orchestrator.run();

    const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(errorCalls.some((m: string) => m.includes('missing requirements section'))).toBe(true);
    expect(errorCalls.some((m: string) => m.includes('no scope defined'))).toBe(true);
  });

  it('should save the fail gate result to checkpoint before retrying', async () => {
    const failResult = { status: 'fail' as const, warnings: [], errors: ['oops'] };
    const passResult = { status: 'pass' as const, warnings: [], errors: [] };

    mockAnalysisGateValidate
      .mockResolvedValueOnce(failResult)
      .mockResolvedValueOnce(passResult);

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    // recordGateResult should have been called at least twice — once for the fail, once for the pass
    expect(checkpoint.recordGateResult).toHaveBeenCalledWith(1, failResult);
    expect(checkpoint.recordGateResult).toHaveBeenCalledWith(1, passResult);
  });

  // ── Gate `fail` behaviour — retry also fails (abort) ─────────────────────

  it('should abort the pipeline when gate fails both times', async () => {
    mockAnalysisGateValidate.mockResolvedValue({
      status: 'fail',
      warnings: [],
      errors: ['critical error'],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(mockAnalysisGateValidate).toHaveBeenCalledTimes(2);
  });

  it('should include descriptive gate error in the abort result', async () => {
    mockAnalysisGateValidate.mockResolvedValue({
      status: 'fail',
      warnings: [],
      errors: ['critical error'],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.error).toContain('Gate validation failed for phase 1');
  });

  it('should append an abort event to the progress log when gate fails twice', async () => {
    mockAnalysisGateValidate.mockResolvedValue({
      status: 'fail',
      warnings: [],
      errors: ['something wrong'],
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const appendCalls = (mockProgressAppendEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([msg]: [string]) => msg,
    );
    expect(
      appendCalls.some((m: string) => m.toLowerCase().includes('abort') && m.includes('gate')),
    ).toBe(true);
  });

  it('should abort pipeline even if retry phase execution itself fails (phase error, not gate)', async () => {
    // Gate returns fail; after retry the phase itself fails (agent error)
    mockAnalysisGateValidate.mockResolvedValueOnce({
      status: 'fail',
      warnings: [],
      errors: ['bad output'],
    });

    // First retry execute succeeds (normal phase run)
    // But second phase execution (the retry) returns a failing phase result
    let retryCallCount = 0;
    mockRetryExecutorExecute.mockImplementation(async ({ fn }: any) => {
      retryCallCount++;
      if (retryCallCount <= 2) {
        // First two calls (analyst + scout in the initial phase run): succeed
        try {
          const result = await fn(1);
          return { success: true, result, attempts: 1, recoveryUsed: false };
        } catch (err) {
          return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
        }
      }
      // Subsequent calls (retry phase): fail
      return { success: false, error: 'Agent crashed', attempts: 1, recoveryUsed: false };
    });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
  });

  // ── Gate not called for skipped phases ────────────────────────────────────

  it('should NOT call gate for a phase that was skipped (resumed from checkpoint)', async () => {
    // All phases skipped via checkpoint completion
    const checkpoint = makeMockCheckpoint([1, 2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockAnalysisGateValidate).not.toHaveBeenCalled();
    expect(mockPlanningGateValidate).not.toHaveBeenCalled();
    expect(mockImplGateValidate).not.toHaveBeenCalled();
    expect(mockIntegrationGateValidate).not.toHaveBeenCalled();
  });

  // ── Gate context is built correctly ───────────────────────────────────────

  it('should pass the worktreePath and baseCommit in the gate context', async () => {
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const [context] = mockAnalysisGateValidate.mock.calls[0];
    expect(context.worktreePath).toBe('/tmp/worktree-42');
    expect(context.baseCommit).toBe('abc123');
  });

  it('should pass the progressDir in the gate context', async () => {
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    const [context] = mockAnalysisGateValidate.mock.calls[0];
    // progressDir is derived from worktree.path + '.cadre/issues/<issueNumber>'
    expect(context.progressDir).toContain('42');
    expect(context.progressDir).toContain('.cadre');
  });
});

// ── Ambiguity gating tests ────────────────────────────────────────────────────

describe('IssueOrchestrator – Ambiguity Gating', () => {
  /** Build an analysis.md string with ambiguity items under "## Ambiguities". */
  function buildAnalysisMd(ambiguities: string[]): string {
    return [
      '# Analysis',
      '',
      '## Ambiguities',
      ...ambiguities,
      '',
      '## Next Section',
      'Other content.',
    ].join('\n');
  }

  /** Config with haltOnAmbiguity enabled and a small threshold. */
  function makeHaltConfig() {
    return makeRuntimeConfig({
      ...makeConfig(),
      options: {
        ...makeConfig().options,
        haltOnAmbiguity: true,
        ambiguityThreshold: 0,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockRetryExecutorExecute.mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<any> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    });

    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockPlanningGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockImplGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockIntegrationGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    mockFsReadFile.mockResolvedValue('');
  });

  it('should call logger.warn for each ambiguity after Phase 1 succeeds', async () => {
    mockFsReadFile.mockResolvedValue(buildAnalysisMd(['- Ambiguity one', '- Ambiguity two']));

    const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      mockLogger as any,
    );

    await orchestrator.run();

    const warnMessages = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls.map(([m]: [string]) => m);
    expect(warnMessages.some((m) => m.includes('Ambiguity one'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('Ambiguity two'))).toBe(true);
  });

  it('should invoke notifyAmbiguities when analysis contains ambiguities', async () => {
    mockFsReadFile.mockResolvedValue(buildAnalysisMd(['- Unclear requirement']));

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint);

    await orchestrator.run();

    expect(mockNotifyAmbiguities).toHaveBeenCalledTimes(1);
    expect(mockNotifyAmbiguities.mock.calls[0][0]).toBe(42);
  });

  it('should return failure without running Phase 2 when haltOnAmbiguity is true and threshold is exceeded', async () => {
    mockFsReadFile.mockResolvedValue(buildAnalysisMd(['- A', '- B']));

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = new IssueOrchestrator(
      makeHaltConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ambiguit/i);
    // Phase 2 gate should not be reached
    expect(mockPlanningGateValidate).not.toHaveBeenCalled();
  });

  it('should continue normally when haltOnAmbiguity is false even if threshold is exceeded', async () => {
    mockFsReadFile.mockResolvedValue(buildAnalysisMd(['- A', '- B']));

    const checkpoint = makeMockCheckpoint([2, 3, 4, 5]);
    const orchestrator = makeOrchestrator(checkpoint); // haltOnAmbiguity defaults to false

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
  });
});
