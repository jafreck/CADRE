/**
 * Tests for IssueOrchestrator's registry-based phase dispatch (task-008 refactor).
 *
 * These tests verify that:
 *  - All five executor classes are registered and dispatched via PhaseRegistry.
 *  - run() iterates registry.getAll() in order (phaseId 1 → 5).
 *  - Dry-run mode stops after phase 2 (executor.phaseId > 2).
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

import { AnalysisPhaseExecutor } from '../src/executors/analysis-phase-executor.js';
import { PlanningPhaseExecutor } from '../src/executors/planning-phase-executor.js';
import { ImplementationPhaseExecutor } from '../src/executors/implementation-phase-executor.js';
import { IntegrationPhaseExecutor } from '../src/executors/integration-phase-executor.js';
import { PRCompositionPhaseExecutor } from '../src/executors/pr-composition-phase-executor.js';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider } from '../src/platform/provider.js';
import type { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail, WorktreeInfo } from '../src/platform/provider.js';
import type { PhaseContext } from '../src/core/phase-executor.js';

// ── Helpers ──

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeCpState(worktreePath: string) {
  return {
    issueNumber: 42,
    version: 1,
    currentPhase: 0,
    currentTask: null,
    completedPhases: [],
    completedTasks: [],
    failedTasks: [],
    blockedTasks: [],
    phaseOutputs: {},
    tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
    worktreePath,
    branchName: 'cadre/issue-42',
    baseCommit: 'abc123',
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };
}

function makeCheckpoint(worktreePath: string, overrides: Partial<CheckpointManager> = {}): CheckpointManager {
  const state = makeCpState(worktreePath);
  return {
    getState: vi.fn(() => state),
    getResumePoint: vi.fn(() => ({ phase: 1, taskId: null })),
    isPhaseCompleted: vi.fn(() => false),
    isTaskCompleted: vi.fn(() => false),
    startPhase: vi.fn(async () => {}),
    completePhase: vi.fn(async () => {}),
    startTask: vi.fn(async () => {}),
    completeTask: vi.fn(async () => {}),
    blockTask: vi.fn(async () => {}),
    failTask: vi.fn(async () => {}),
    recordTokenUsage: vi.fn(async () => {}),
    recordGateResult: vi.fn(async () => {}),
    ...overrides,
  } as unknown as CheckpointManager;
}

function makePlatform(): PlatformProvider {
  return {
    issueLinkSuffix: vi.fn(() => 'Closes #42'),
    createPullRequest: vi.fn(async () => ({ number: 1, url: 'https://github.com/test/pr/1' })),
  } as unknown as PlatformProvider;
}

function makeLauncher(): AgentLauncher {
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
  } as unknown as AgentLauncher;
}

function makeConfig(overrides: Partial<CadreConfig['options']> = {}): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42] },
    branchTemplate: 'cadre/issue-{issue}',
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
      maxRetriesPerTask: 1,
      tokenBudget: undefined,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
      ...overrides,
    },
    commands: {},
    copilot: {
      cliCommand: 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    environment: {
      inheritShellPath: true,
      extraPath: [],
    },
  } as CadreConfig;
}

function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: 'https://github.com/owner/repo/issues/42',
  };
}

/** Build a mock PhaseExecutor with a given phaseId that resolves successfully. */
function makeExecutorMock(phaseId: number, name: string) {
  return {
    phaseId,
    name,
    execute: vi.fn(async (_ctx: PhaseContext) => `/output/phase-${phaseId}.md`),
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
    vi.restoreAllMocks();
  });

  function makeWorktree(): WorktreeInfo {
    return {
      path: worktreePath,
      branch: 'cadre/issue-42',
      baseCommit: 'abc123',
      issueNumber: 42,
    } as unknown as WorktreeInfo;
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
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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

      const checkpoint = makeCheckpoint(worktreePath, {
        isPhaseCompleted: vi.fn(() => true),
      });

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        checkpoint,
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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
      const issue = makeIssue();
      const worktree = makeWorktree();

      const orchestrator = new IssueOrchestrator(
        config,
        issue,
        worktree,
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
      );

      await orchestrator.run();

      expect(analysisExec.execute).toHaveBeenCalledTimes(1);
      const ctx: PhaseContext = analysisExec.execute.mock.calls[0][0];

      // Verify the PhaseContext has essential fields
      expect(ctx.issue).toBe(issue);
      expect(ctx.config).toBe(config);
      expect(ctx.worktree).toBe(worktree);
      expect(typeof ctx.recordTokens).toBe('function');
      expect(typeof ctx.checkBudget).toBe('function');
      expect(ctx.logger).toBeDefined();
      expect(ctx.launcher).toBeDefined();
      expect(ctx.checkpoint).toBeDefined();
      expect(ctx.progressDir).toContain(String(issue.number));
    });
  });

  // ── Critical phase failure ──

  describe('run() – critical phase failure', () => {
    it('should abort the pipeline when a critical phase (1) fails', async () => {
      const execs = [
        { phaseId: 1, name: 'Analysis & Scouting', execute: vi.fn().mockRejectedValue(new Error('analysis failed')) },
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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
        { phaseId: 3, name: 'Implementation', execute: vi.fn().mockRejectedValue(new Error('implementation failed')) },
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
      );

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(result.phases[2].success).toBe(false);
      // Phase 4 should not run after critical failure
      expect(execs[3].execute).not.toHaveBeenCalled();
    });
  });

  // ── Non-critical phase failure ──

  describe('run() – non-critical phase failure', () => {
    it('should continue the pipeline when a non-critical phase (4) fails', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        { phaseId: 4, name: 'Integration Verification', execute: vi.fn().mockRejectedValue(new Error('integration failed')) },
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
      );

      const result = await orchestrator.run();

      // Phase 4 failed but pipeline should still complete (success = true)
      expect(result.phases[3].success).toBe(false);
      // Phase 5 still executed
      expect(execs[4].execute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should continue the pipeline when a non-critical phase (5) fails', async () => {
      const execs = [
        makeExecutorMock(1, 'Analysis & Scouting'),
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        { phaseId: 5, name: 'PR Composition', execute: vi.fn().mockRejectedValue(new Error('pr failed')) },
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
      );

      const result = await orchestrator.run();

      expect(result.phases[4].success).toBe(false);
      // Overall pipeline completes (non-critical failure)
      expect(result.success).toBe(true);
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
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
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
        { phaseId: 1, name: 'Analysis & Scouting', execute: vi.fn().mockRejectedValue(new Error('boom')) },
        makeExecutorMock(2, 'Planning'),
        makeExecutorMock(3, 'Implementation'),
        makeExecutorMock(4, 'Integration Verification'),
        makeExecutorMock(5, 'PR Composition'),
      ];
      setupExecutorMocks(execs);

      const orchestrator = new IssueOrchestrator(
        makeConfig(),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint(worktreePath),
        makeLauncher(),
        makePlatform(),
        makeLogger(),
      );

      const result = await orchestrator.run();

      const phase1 = result.phases[0];
      expect(phase1.success).toBe(false);
      expect(phase1.error).toContain('boom');
    });
  });
});
