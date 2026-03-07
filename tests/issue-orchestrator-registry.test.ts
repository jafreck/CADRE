/**
 * Tests for IssueOrchestrator's registry-based phase dispatch (task-008 refactor).
 *
 * These tests verify that:
 *  - All five executor classes are registered and dispatched via PhaseRegistry.
 *  - run() iterates registry.getAll() in order (id 1 → 5).
 *  - Dry-run mode stops after phase 2 (executor.id > 2).
 *  - executePhase() calls executor.execute() with a complete PhaseContext.
 *  - Critical phase failure aborts the pipeline.
 *  - Non-critical phase failure does NOT abort the pipeline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Module mocks must be declared before any imports that use them ──

vi.mock('../src/executors/analysis-phase-executor.js', () => ({
  AnalysisPhaseExecutor: vi.fn(),
}));
vi.mock('../src/executors/planning-phase-executor.js', () => ({
  PlanningPhaseExecutor: vi.fn(),
}));
vi.mock('../src/executors/implementation-phase-executor.js', () => ({
  ImplementationPhaseExecutor: vi.fn(),
}));
vi.mock('../src/executors/integration-phase-executor.js', () => ({
  IntegrationPhaseExecutor: vi.fn(),
}));
vi.mock('../src/executors/pr-composition-phase-executor.js', () => ({
  PRCompositionPhaseExecutor: vi.fn(),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    isClean: vi.fn().mockResolvedValue(true),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(''),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue(undefined),
    stripCadreFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock phase gates so they always pass
vi.mock('../src/core/pipeline/phase-gate.js', () => {
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

import { AnalysisPhaseExecutor } from '../src/executors/analysis-phase-executor.js';
import { PlanningPhaseExecutor } from '../src/executors/planning-phase-executor.js';
import { ImplementationPhaseExecutor } from '../src/executors/implementation-phase-executor.js';
import { IntegrationPhaseExecutor } from '../src/executors/integration-phase-executor.js';
import { PRCompositionPhaseExecutor } from '../src/executors/pr-composition-phase-executor.js';
import { IssueOrchestrator } from '../src/core/pipeline/issue-orchestrator.js';
import type { PhaseContext } from '../src/core/pipeline/phase-executor.js';
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

function makeConfig(overrides: Record<string, unknown> = {}) {
  return makeRuntimeConfig({
    issues: { ids: [42] },
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
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
      ...overrides,
    } as any,
  });
}

/** Build a mock PhaseExecutor with a given id that resolves successfully. */
function makeExecutorMock(id: number, name: string) {
  return {
    id,
    name,
    execute: vi.fn(async (_ctx: PhaseContext) => `/output/phase-${id}.md`),
  };
}

// ── Test suite ──

describe('IssueOrchestrator – PhaseRegistry dispatch (task-008)', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });

    // Reset all constructor mocks
    vi.mocked(AnalysisPhaseExecutor).mockClear();
    vi.mocked(PlanningPhaseExecutor).mockClear();
    vi.mocked(ImplementationPhaseExecutor).mockClear();
    vi.mocked(IntegrationPhaseExecutor).mockClear();
    vi.mocked(PRCompositionPhaseExecutor).mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeWorktree() {
    return makeMockWorktree({ path: worktreePath });
  }

  function setupExecutorMocks(executors: ReturnType<typeof makeExecutorMock>[]) {
    const [a, p, i, n, pr] = executors;
    vi.mocked(AnalysisPhaseExecutor).mockImplementation(() => a as never);
    vi.mocked(PlanningPhaseExecutor).mockImplementation(() => p as never);
    vi.mocked(ImplementationPhaseExecutor).mockImplementation(() => i as never);
    vi.mocked(IntegrationPhaseExecutor).mockImplementation(() => n as never);
    vi.mocked(PRCompositionPhaseExecutor).mockImplementation(() => pr as never);
    return executors;
  }

  // ── Constructor registration ──

  describe('constructor', () => {
    it('should instantiate all five executor classes exactly once', () => {
      vi.mocked(AnalysisPhaseExecutor).mockImplementation(() => makeExecutorMock(1, 'Analysis & Scouting') as never);
      vi.mocked(PlanningPhaseExecutor).mockImplementation(() => makeExecutorMock(2, 'Planning') as never);
      vi.mocked(ImplementationPhaseExecutor).mockImplementation(() => makeExecutorMock(3, 'Implementation') as never);
      vi.mocked(IntegrationPhaseExecutor).mockImplementation(() => makeExecutorMock(4, 'Integration Verification') as never);
      vi.mocked(PRCompositionPhaseExecutor).mockImplementation(() => makeExecutorMock(5, 'PR Composition') as never);

      new IssueOrchestrator(
        makeConfig(),
        makeMockIssue(),
        makeWorktree(),
        makeMockCheckpoint(),
        makeLauncher(),
        makePlatform(),
        makeMockLogger(),
      );

      expect(AnalysisPhaseExecutor).toHaveBeenCalledTimes(1);
      expect(PlanningPhaseExecutor).toHaveBeenCalledTimes(1);
      expect(ImplementationPhaseExecutor).toHaveBeenCalledTimes(1);
      expect(IntegrationPhaseExecutor).toHaveBeenCalledTimes(1);
      expect(PRCompositionPhaseExecutor).toHaveBeenCalledTimes(1);
    });
  });

  // ── run() registry iteration ──

  describe('run() – registry iteration', () => {
    it('should call executor.execute() for each of the 5 phases in order', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
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

      const result = await orchestrator.run();

      expect(result.success).toBe(true);
      for (const exec of execs) {
        expect(exec.execute).toHaveBeenCalledTimes(1);
      }

      // Verify phase IDs reported in result are 1..5 in order
      const phaseIds = result.phases.map((p) => p.phase);
      expect(phaseIds).toEqual([1, 2, 3, 4, 5]);
    });

    it('should skip all phases when all are already completed', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const checkpoint = makeMockCheckpoint([], {
        isPhaseCompleted: vi.fn(() => true),
      });

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeMockIssue(),
        makeWorktree(),
        checkpoint,
        makeLauncher(),
        makePlatform(),
        makeMockLogger(),
      );

      await orchestrator.run();

      for (const exec of execs) {
        expect(exec.execute).not.toHaveBeenCalled();
      }
    });
  });

  // ── Dry-run: stops after phase 2 ──

  describe('run() – dry-run mode', () => {
    it('should only execute phases 1 and 2 when dryRun is true', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig({ dryRun: true }),
        makeMockIssue(),
        makeWorktree(),
        makeMockCheckpoint(),
        makeLauncher(),
        makePlatform(),
        makeMockLogger(),
      );

      const result = await orchestrator.run();

      expect(execs[0].execute).toHaveBeenCalledTimes(1);
      expect(execs[1].execute).toHaveBeenCalledTimes(1);
      expect(execs[2].execute).not.toHaveBeenCalled();
      expect(execs[3].execute).not.toHaveBeenCalled();
      expect(execs[4].execute).not.toHaveBeenCalled();
      // Only phases 1 and 2 are added to result.phases
      expect(result.phases).toHaveLength(2);
    });
  });

  // ── PhaseContext delegation ──

  describe('executePhase() – PhaseContext delegation', () => {
    it('should call executor.execute() with a PhaseContext containing issue, config, worktree, and helpers', async () => {
      const analysisExec = makeExecutorMock(1, 'Analysis & Scouting');
      const execs = [
        analysisExec,
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const config = makeConfig();
      const issue = makeMockIssue();
      const worktree = makeWorktree();

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        makeMockCheckpoint(),
        makeLauncher(),
        makePlatform(),
        makeMockLogger(),
      );

      await orchestrator.run();

      expect(analysisExec.execute).toHaveBeenCalledTimes(1);
      const ctx: PhaseContext = analysisExec.execute.mock.calls[0][0];

      // Verify the PhaseContext has essential fields
      expect(ctx.issue).toBe(issue);
      expect(ctx.config).toBe(config);
      expect(ctx.worktree).toBe(worktree);
      expect(typeof ctx.callbacks.recordTokens).toBe('function');
      expect(typeof ctx.callbacks.checkBudget).toBe('function');
      expect(typeof ctx.callbacks.updateProgress).toBe('function');
      expect(ctx.services.logger).toBeDefined();
      expect(ctx.services.launcher).toBeDefined();
      expect(ctx.io.checkpoint).toBeDefined();
      expect(ctx.io.progressDir).toContain(String(issue.number));
    });
  });

  // ── Critical phase failure ──

  describe('run() – critical phase failure', () => {
    it('should abort the pipeline when a critical phase (1) fails', async () => {
      const execs = [
        { id: 1, name: 'Analysis & Scouting', execute: vi.fn().mockRejectedValue(new Error('analysis failed')) },
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

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain('analysis failed');
      // Subsequent phases should not execute
      expect(execs[1].execute).not.toHaveBeenCalled();
      expect(execs[2].execute).not.toHaveBeenCalled();
    });

    it('should abort the pipeline when a critical phase (3) fails', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        { id: 3, name: 'Implementation', execute: vi.fn().mockRejectedValue(new Error('implementation failed')) },
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

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(result.phases[2].success).toBe(false);
      // Phase 4 should not run after critical failure
      expect(execs[3].execute).not.toHaveBeenCalled();
    });

    it('should abort the pipeline when a critical phase (5) fails', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        { id: 5, name: 'PR Composition', execute: vi.fn().mockRejectedValue(new Error('pr failed')) },
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

      const result = await orchestrator.run();

      expect(result.phases[4].success).toBe(false);
      // Phase 5 is critical — overall pipeline should fail
      expect(result.success).toBe(false);
    });
  });

  // ── Non-critical phase failure ──

  describe('run() – critical phase 4 failure', () => {
    it('should abort the pipeline when critical phase (4) fails', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        { id: 4, name: 'Integration Verification', execute: vi.fn().mockRejectedValue(new Error('integration failed')) },
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

      const result = await orchestrator.run();

      // Phase 4 failed and is critical — pipeline should abort
      expect(result.phases[3].success).toBe(false);
      // Phase 5 should NOT have executed
      expect(execs[4].execute).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  // ── Phase result shape ──

  describe('executePhase() – PhaseResult shape', () => {
    it('should return a PhaseResult with correct phase, phaseName, success, and outputPath on success', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
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

      const result = await orchestrator.run();

      const phase1 = result.phases[0];
      expect(phase1.phase).toBe(1);
      expect(phase1.phaseName).toBe('Analysis & Scouting');
      expect(phase1.success).toBe(true);
      expect(phase1.outputPath).toBe('/output/phase-1.md');
    });

    it('should return a PhaseResult with error string when executor throws', async () => {
      const execs = [
        { id: 1, name: 'Analysis & Scouting', execute: vi.fn().mockRejectedValue(new Error('boom')) },
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

      const result = await orchestrator.run();

      const phase1 = result.phases[0];
      expect(phase1.success).toBe(false);
      expect(phase1.error).toContain('boom');
    });
  });
});
