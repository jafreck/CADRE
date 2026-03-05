/**
 * Tests for the refactored IssueOrchestrator's delegation to IssueBudgetGuard
 * and commitPerPhase behavior introduced in the session-003 thin-coordinator refactor.
 *
 * These tests verify that:
 *  - ctx.callbacks.recordTokens delegates to IssueBudgetGuard.recordTokens
 *  - ctx.callbacks.checkBudget delegates to IssueBudgetGuard.checkBudget
 *  - CommitManager.commit is called after each phase when commitPerPhase is true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Module mocks — hoisted before any imports ──

const guardRecordTokens = vi.fn();
const guardCheckBudget = vi.fn();

vi.mock('../src/core/issue-budget-guard.js', () => {
  class BudgetExceededError extends Error {
    constructor() {
      super('Per-issue token budget exceeded');
      this.name = 'BudgetExceededError';
    }
  }
  const IssueBudgetGuard = vi.fn().mockImplementation(() => ({
    recordTokens: guardRecordTokens,
    checkBudget: guardCheckBudget,
  }));
  return { IssueBudgetGuard, BudgetExceededError };
});

const commitMock = vi.fn().mockResolvedValue(undefined);
const isCleanMock = vi.fn().mockResolvedValue(false);

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    isClean: isCleanMock,
    commit: commitMock,
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(''),
    stripCadreFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/executors/analysis-phase-executor.js', () => ({ AnalysisPhaseExecutor: vi.fn() }));
vi.mock('../src/executors/planning-phase-executor.js', () => ({ PlanningPhaseExecutor: vi.fn() }));
vi.mock('../src/executors/implementation-phase-executor.js', () => ({ ImplementationPhaseExecutor: vi.fn() }));
vi.mock('../src/executors/integration-phase-executor.js', () => ({ IntegrationPhaseExecutor: vi.fn() }));
vi.mock('../src/executors/pr-composition-phase-executor.js', () => ({ PRCompositionPhaseExecutor: vi.fn() }));

vi.mock('../src/core/phase-gate.js', () => {
  const makeGate = () => ({ validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })) });
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

vi.mock('../src/core/issue-notifier.js', () => ({
  IssueNotifier: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ── Imports ──

import { AnalysisPhaseExecutor } from '../src/executors/analysis-phase-executor.js';
import { PlanningPhaseExecutor } from '../src/executors/planning-phase-executor.js';
import { ImplementationPhaseExecutor } from '../src/executors/implementation-phase-executor.js';
import { IntegrationPhaseExecutor } from '../src/executors/integration-phase-executor.js';
import { PRCompositionPhaseExecutor } from '../src/executors/pr-composition-phase-executor.js';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { IssueBudgetGuard, BudgetExceededError } from '../src/core/issue-budget-guard.js';
import { IssueNotifier } from '../src/core/issue-notifier.js';
import { CommitManager } from '../src/git/commit.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import { makeMockLogger } from './helpers/make-mock-logger.js';
import { makeMockCheckpoint } from './helpers/make-mock-checkpoint.js';
import { makeMockIssue } from './helpers/make-mock-issue.js';
import { makeMockWorktree } from './helpers/make-mock-worktree.js';

// ── Helpers ──

function makePlatform() {
  return {
    issueLinkSuffix: vi.fn(() => 'Closes #42'),
    createPullRequest: vi.fn(async () => ({ number: 1, url: 'https://github.com/test/pr/1' })),
  } as any;
}

function makeLauncher() {
  return {
    launchAgent: vi.fn(async () => ({
      agent: 'test-agent',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      stdout: '',
      stderr: '',
      tokenUsage: 0,
      outputPath: '',
      outputExists: false,
    })),
  } as any;
}

function makeConfig(
  overrides: Record<string, unknown> = {},
  commitOverrides: Record<string, unknown> = {},
) {
  return makeRuntimeConfig({
    issues: { ids: [42] },
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
      ...commitOverrides,
    },
    pullRequest: {
      autoCreate: false,
      autoComplete: false,
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
      ambiguityThreshold: 5,
      haltOnAmbiguity: false,
      ...overrides,
    } as any,
  });
}

function makeExecutorMock(phaseId: number, name: string) {
  return {
    phaseId,
    name,
    execute: vi.fn(async (_ctx: PhaseContext) => `/output/phase-${phaseId}.md`),
  };
}

function setupExecutorMocks(executors: ReturnType<typeof makeExecutorMock>[]) {
  const [a, p, i, n, pr] = executors;
  vi.mocked(AnalysisPhaseExecutor).mockImplementation(() => a as never);
  vi.mocked(PlanningPhaseExecutor).mockImplementation(() => p as never);
  vi.mocked(ImplementationPhaseExecutor).mockImplementation(() => i as never);
  vi.mocked(IntegrationPhaseExecutor).mockImplementation(() => n as never);
  vi.mocked(PRCompositionPhaseExecutor).mockImplementation(() => pr as never);
}

// ── Test suites ──

describe('IssueOrchestrator – budget callback delegation (session-003 refactor)', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    // Reset only specific mocks rather than all, to preserve module-level mock implementations
    guardRecordTokens.mockReset();
    guardCheckBudget.mockReset();
    commitMock.mockReset().mockResolvedValue(undefined);
    isCleanMock.mockReset().mockResolvedValue(false);
    vi.mocked(IssueBudgetGuard).mockClear().mockImplementation(() => ({
      recordTokens: guardRecordTokens,
      checkBudget: guardCheckBudget,
    }));
    vi.mocked(IssueNotifier).mockClear().mockImplementation(() => ({
      notify: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(AnalysisPhaseExecutor).mockClear();
    vi.mocked(PlanningPhaseExecutor).mockClear();
    vi.mocked(ImplementationPhaseExecutor).mockClear();
    vi.mocked(IntegrationPhaseExecutor).mockClear();
    vi.mocked(PRCompositionPhaseExecutor).mockClear();
    vi.mocked(CommitManager).mockClear().mockImplementation(() => ({
      isClean: isCleanMock,
      commit: commitMock,
      push: vi.fn().mockResolvedValue(undefined),
      squash: vi.fn().mockResolvedValue(undefined),
      getChangedFiles: vi.fn().mockResolvedValue([]),
      getDiff: vi.fn().mockResolvedValue(''),
      stripCadreFiles: vi.fn().mockResolvedValue(undefined),
    }));
    tempDir = join(tmpdir(), `cadre-budget-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeWorktree() {
    return makeMockWorktree({ path: worktreePath });
  }

  it('should construct IssueBudgetGuard with the configured tokenBudget', async () => {
    const execs = [
      makeExecutorMock(1, 'Analysis & Scouting'),
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const config = makeConfig({ tokenBudget: 50_000 });
    const orchestrator = new IssueOrchestrator(
      config,
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(IssueBudgetGuard).toHaveBeenCalledOnce();
    const constructorArgs = vi.mocked(IssueBudgetGuard).mock.calls[0];
    // 4th arg is issueNumber, 5th is tokenBudget
    expect(constructorArgs[3]).toBe(42);
    expect(constructorArgs[4]).toBe(50_000);
  });

  it('should wire ctx.callbacks.recordTokens to delegate to IssueBudgetGuard.recordTokens', async () => {
    const analysisExec = makeExecutorMock(1, 'Analysis & Scouting');
    let capturedCtx: PhaseContext | undefined;
    analysisExec.execute.mockImplementation(async (ctx: PhaseContext) => {
      capturedCtx = ctx;
      ctx.callbacks.recordTokens('analysis-agent', 1234);
      return '/output/phase-1.md';
    });

    const execs = [
      analysisExec,
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(capturedCtx).toBeDefined();
    const guardInstance = vi.mocked(IssueBudgetGuard).mock.results[0].value;
    expect(guardInstance.recordTokens).toHaveBeenCalledWith('analysis-agent', 1234);
  });

  it('should wire ctx.callbacks.checkBudget to delegate to IssueBudgetGuard.checkBudget', async () => {
    const analysisExec = makeExecutorMock(1, 'Analysis & Scouting');
    let capturedCtx: PhaseContext | undefined;
    analysisExec.execute.mockImplementation(async (ctx: PhaseContext) => {
      capturedCtx = ctx;
      ctx.callbacks.checkBudget();
      return '/output/phase-1.md';
    });

    const execs = [
      analysisExec,
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(capturedCtx).toBeDefined();
    const guardInstance = vi.mocked(IssueBudgetGuard).mock.results[0].value;
    expect(guardInstance.checkBudget).toHaveBeenCalled();
  });

  it('should abort the pipeline and return budgetExceeded=true when checkBudget throws BudgetExceededError', async () => {
    const analysisExec = makeExecutorMock(1, 'Analysis & Scouting');
    analysisExec.execute.mockRejectedValue(new BudgetExceededError());

    const execs = [
      analysisExec,
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const checkpoint = makeMockCheckpoint();

    const orchestrator = new IssueOrchestrator(
      makeConfig({ tokenBudget: 100 }),
      makeMockIssue(),
      makeWorktree(),
      checkpoint,
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.error).toContain('budget');
    // Subsequent phases must not execute
    expect(execs[1].execute).not.toHaveBeenCalled();
  });

  it('should persist budgetExceeded via recordTokenUsage when budget is exceeded', async () => {
    const analysisExec = makeExecutorMock(1, 'Analysis & Scouting');
    analysisExec.execute.mockRejectedValue(new BudgetExceededError());

    const execs = [
      analysisExec,
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const checkpoint = makeMockCheckpoint();
    // Ensure budgetExceeded flag can be set in checkpoint state
    (checkpoint.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      ...checkpoint.getState(),
      worktreePath,
      budgetExceeded: false,
    });

    const orchestrator = new IssueOrchestrator(
      makeConfig({ tokenBudget: 100 }),
      makeMockIssue(),
      makeWorktree(),
      checkpoint,
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(checkpoint.recordTokenUsage).toHaveBeenCalledWith('__budget__', expect.anything(), 0);
  });
});

describe('IssueOrchestrator – commitPerPhase delegation (session-003 refactor)', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    // Reset only specific mocks rather than all
    guardRecordTokens.mockReset();
    guardCheckBudget.mockReset();
    commitMock.mockReset().mockResolvedValue(undefined);
    isCleanMock.mockReset().mockResolvedValue(false);
    vi.mocked(IssueBudgetGuard).mockClear().mockImplementation(() => ({
      recordTokens: guardRecordTokens,
      checkBudget: guardCheckBudget,
    }));
    vi.mocked(IssueNotifier).mockClear().mockImplementation(() => ({
      notify: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(AnalysisPhaseExecutor).mockClear();
    vi.mocked(PlanningPhaseExecutor).mockClear();
    vi.mocked(ImplementationPhaseExecutor).mockClear();
    vi.mocked(IntegrationPhaseExecutor).mockClear();
    vi.mocked(PRCompositionPhaseExecutor).mockClear();
    tempDir = join(tmpdir(), `cadre-commit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeWorktree() {
    return makeMockWorktree({ path: worktreePath });
  }

  it('should call CommitManager.commit after each phase when commitPerPhase is true', async () => {
    isCleanMock.mockResolvedValue(false);
    vi.mocked(CommitManager).mockImplementation(() => ({
      isClean: isCleanMock,
      commit: commitMock,
      push: vi.fn().mockResolvedValue(undefined),
      squash: vi.fn().mockResolvedValue(undefined),
      getChangedFiles: vi.fn().mockResolvedValue([]),
      getDiff: vi.fn().mockResolvedValue(''),
      stripCadreFiles: vi.fn().mockResolvedValue(undefined),
    }) as never);

    const execs = [
      makeExecutorMock(1, 'Analysis & Scouting'),
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const orchestrator = new IssueOrchestrator(
      makeConfig({}, { commitPerPhase: true }),
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    // One commit per phase (5 phases)
    expect(commitMock).toHaveBeenCalledTimes(5);
  });

  it('should NOT call CommitManager.commit when commitPerPhase is false', async () => {
    isCleanMock.mockResolvedValue(false);
    vi.mocked(CommitManager).mockImplementation(() => ({
      isClean: isCleanMock,
      commit: commitMock,
      push: vi.fn().mockResolvedValue(undefined),
      squash: vi.fn().mockResolvedValue(undefined),
      getChangedFiles: vi.fn().mockResolvedValue([]),
      getDiff: vi.fn().mockResolvedValue(''),
      stripCadreFiles: vi.fn().mockResolvedValue(undefined),
    }) as never);

    const execs = [
      makeExecutorMock(1, 'Analysis & Scouting'),
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const orchestrator = new IssueOrchestrator(
      makeConfig({}, { commitPerPhase: false }),
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(commitMock).not.toHaveBeenCalled();
  });

  it('should NOT call CommitManager.commit when worktree is clean even with commitPerPhase=true', async () => {
    isCleanMock.mockResolvedValue(true); // clean → no commit
    vi.mocked(CommitManager).mockImplementation(() => ({
      isClean: isCleanMock,
      commit: commitMock,
      push: vi.fn().mockResolvedValue(undefined),
      squash: vi.fn().mockResolvedValue(undefined),
      getChangedFiles: vi.fn().mockResolvedValue([]),
      getDiff: vi.fn().mockResolvedValue(''),
      stripCadreFiles: vi.fn().mockResolvedValue(undefined),
    }) as never);

    const execs = [
      makeExecutorMock(1, 'Analysis & Scouting'),
      makeExecutorMock(2, 'Planning'),
      makeExecutorMock(3, 'Implementation'),
      makeExecutorMock(4, 'Integration Verification'),
      makeExecutorMock(5, 'PR Composition'),
    ];
    setupExecutorMocks(execs);

    const orchestrator = new IssueOrchestrator(
      makeConfig({}, { commitPerPhase: true }),
      makeMockIssue(),
      makeWorktree(),
      makeMockCheckpoint(),
      makeLauncher(),
      makePlatform(),
      makeMockLogger(),
    );

    await orchestrator.run();

    expect(commitMock).not.toHaveBeenCalled();
  });
});
