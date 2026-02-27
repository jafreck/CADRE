import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { PlanningPhaseExecutor } from '../src/executors/planning-phase-executor.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult } from '../src/agents/types.js';

function makeSuccessAgentResult(agent: string): AgentResult {
  return {
    agent: agent as AgentResult['agent'],
    success: true,
    exitCode: 0,
    timedOut: false,
    duration: 100,
    stdout: '',
    stderr: '',
    tokenUsage: 50,
    outputPath: '/progress/output.md',
    outputExists: true,
  };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  const recordTokens = vi.fn();
  const checkBudget = vi.fn();

  const plannerResult = makeSuccessAgentResult('implementation-planner');

  const launcher = {
    launchAgent: vi.fn().mockResolvedValueOnce(plannerResult),
  };

  const retryExecutor = {
    execute: vi.fn(async ({ fn }: { fn: () => Promise<AgentResult> }) => {
      try {
        const result = await fn();
        return { success: true, result };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }),
  };

  const contextBuilder = {
    build: vi.fn().mockResolvedValue('/progress/planner-ctx.json'),
  };

  const resultParser = {
    parseImplementationPlan: vi.fn().mockResolvedValue([
      { id: 'session-001', name: 'Session 1', rationale: 'r', dependencies: [], steps: [{ id: 'session-001-step-001', name: 'Step 1', description: 'd', files: ['src/a.ts'], complexity: 'simple', acceptanceCriteria: ['ok'] }] },
      { id: 'session-002', name: 'Session 2', rationale: 'r', dependencies: ['session-001'], steps: [{ id: 'session-002-step-001', name: 'Step 1', description: 'd', files: ['src/b.ts'], complexity: 'simple', acceptanceCriteria: ['ok'] }] },
    ]),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const services = {
    launcher: launcher as never,
    retryExecutor: retryExecutor as never,
    tokenTracker: {} as never,
    contextBuilder: contextBuilder as never,
    resultParser: resultParser as never,
    logger: logger as never,
  };

  const io = {
    progressDir: '/tmp/progress',
    progressWriter: {} as never,
    checkpoint: {} as never,
    commitManager: {} as never,
  };

  const callbacks = {
    recordTokens,
    checkBudget,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };

  return {
    issue: {
      number: 42,
      title: 'Test issue',
      body: 'Test body',
      labels: [],
      assignees: [],
      state: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: 'https://github.com/owner/repo/issues/42',
    },
    worktree: { path: '/tmp/worktree', branch: 'cadre/issue-42', baseCommit: 'abc123', issueNumber: 42 } as never,
    config: {
      options: { maxRetriesPerTask: 3 },
    } as never,
    platform: {} as never,
    services: { ...services, ...overrides.services } as never,
    io: { ...io, ...overrides.io } as never,
    callbacks: { ...callbacks, ...overrides.callbacks } as never,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => !['services', 'io', 'callbacks'].includes(k)),
    ),
  } as PhaseContext;
}

describe('PlanningPhaseExecutor', () => {
  let executor: PlanningPhaseExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new PlanningPhaseExecutor();
  });

  describe('PhaseExecutor contract', () => {
    it('should have phaseId of 2', () => {
      expect(executor.phaseId).toBe(2);
    });

    it('should have name "Planning"', () => {
      expect(executor.name).toBe('Planning');
    });

    it('should implement the PhaseExecutor interface', () => {
      expect(typeof executor.execute).toBe('function');
    });
  });

  describe('execute() happy path', () => {
    it('should build context for implementation-planner with correct args', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.contextBuilder as never as { build: ReturnType<typeof vi.fn> })
          .build,
      ).toHaveBeenCalledWith(
        'implementation-planner',
        expect.objectContaining({
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          analysisPath: join('/tmp/progress', 'analysis.md'),
          scoutReportPath: join('/tmp/progress', 'scout-report.md'),
          progressDir: '/tmp/progress',
        }),
      );
    });

    it('should launch implementation-planner with correct invocation', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'implementation-planner',
          issueNumber: 42,
          phase: 2,
          contextPath: '/progress/planner-ctx.json',
          outputPath: join('/tmp/progress', 'implementation-plan.md'),
        }),
        '/tmp/worktree',
      );
    });

    it('should parse the implementation plan from implementation-plan.md', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.resultParser as never as { parseImplementationPlan: ReturnType<typeof vi.fn> })
          .parseImplementationPlan,
      ).toHaveBeenCalledWith(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should return path to implementation-plan.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should record tokens for implementation-planner', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('implementation-planner', 50);
    });

    it('should check budget during execution', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.callbacks.checkBudget).toHaveBeenCalled();
      expect((ctx.callbacks.checkBudget as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should log info with task count after successful plan validation', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.logger as never as { info: ReturnType<typeof vi.fn> }).info,
      ).toHaveBeenCalledWith(
        expect.stringContaining('2 sessions'),
        expect.objectContaining({ issueNumber: 42, phase: 2 }),
      );
    });
  });

  describe('execute() error handling', () => {
    it('should throw if implementation-planner agent fails', async () => {
      const plannerResult: AgentResult = {
        agent: 'implementation-planner',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: 'planner error',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'planner error',
      };

      const launcher = { launchAgent: vi.fn().mockResolvedValue(plannerResult) };
      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Implementation planner failed:');
    });

    it('should throw if parsed plan has zero tasks', async () => {
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([]),
      };
      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Implementation plan produced zero sessions');
    });

    it('should throw if the dependency graph has a cycle', async () => {
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([
          { id: 'session-001', name: 'Session 1', rationale: 'r', dependencies: ['session-002'], steps: [{ id: 'session-001-step-001', name: 'Step 1', description: 'd', files: ['src/a.ts'], complexity: 'simple', acceptanceCriteria: ['ok'] }] },
          { id: 'session-002', name: 'Session 2', rationale: 'r', dependencies: ['session-001'], steps: [{ id: 'session-002-step-001', name: 'Step 1', description: 'd', files: ['src/b.ts'], complexity: 'simple', acceptanceCriteria: ['ok'] }] },
        ]),
      };
      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Invalid implementation plan:');
    });

    it('should throw if retryExecutor fails completely', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Implementation planner failed:');
    });
  });

  describe('launchWithRetry uses correct retry configuration', () => {
    it('should pass maxRetriesPerTask from config to retryExecutor', async () => {
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: () => Promise<AgentResult> }) => {
          const result = await fn();
          return { success: true, result };
        }),
      };

      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await executor.execute(ctx);

      expect(retryExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ maxAttempts: 3 }),
      );
    });

    it('should use agent name as description for retryExecutor', async () => {
      const descriptions: string[] = [];
      const retryExecutor = {
        execute: vi.fn(async ({ fn, description }: { fn: () => Promise<AgentResult>; description: string }) => {
          descriptions.push(description);
          const result = await fn();
          return { success: true, result };
        }),
      };

      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await executor.execute(ctx);

      expect(descriptions).toContain('implementation-planner');
    });
  });
});
