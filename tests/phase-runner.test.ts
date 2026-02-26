import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseRunner } from '../src/core/phase-runner.js';
import { BudgetExceededError } from '../src/core/issue-budget-guard.js';
import type { GateCoordinator } from '../src/core/gate-coordinator.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { IssueProgressWriter } from '../src/core/progress.js';
import type { TokenTracker } from '../src/budget/token-tracker.js';
import type { Logger } from '../src/logging/logger.js';
import type { PhaseExecutor, PhaseContext } from '../src/core/phase-executor.js';
import type { PhaseResult } from '../src/agents/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGateCoordinator(gateStatus: 'pass' | 'warn' | 'fail' = 'pass'): GateCoordinator {
  return {
    runGate: vi.fn().mockResolvedValue(gateStatus),
    readAmbiguities: vi.fn().mockResolvedValue([]),
  } as unknown as GateCoordinator;
}

function makeCheckpoint(): CheckpointManager {
  return {
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
  } as unknown as CheckpointManager;
}

function makeProgressWriter(): IssueProgressWriter {
  return {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as IssueProgressWriter;
}

function makeTokenTracker(total = 0): TokenTracker {
  return {
    getTotal: vi.fn().mockReturnValue(total),
  } as unknown as TokenTracker;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeExecutor(overrides: Partial<PhaseExecutor> = {}): PhaseExecutor {
  return {
    phaseId: 1,
    name: 'Analysis & Scouting',
    execute: vi.fn().mockResolvedValue('/tmp/output/analysis.md'),
    ...overrides,
  };
}

const MOCK_CTX = {} as PhaseContext;

function makePhaseRunner(
  gateCoordinator: GateCoordinator = makeGateCoordinator(),
  checkpoint: CheckpointManager = makeCheckpoint(),
  progressWriter: IssueProgressWriter = makeProgressWriter(),
  tokenTracker: TokenTracker = makeTokenTracker(),
  logger: Logger = makeLogger(),
): PhaseRunner {
  return new PhaseRunner(gateCoordinator, checkpoint, progressWriter, tokenTracker, logger, 42);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PhaseRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runPhase - successful execution with pass gate', () => {
    it('returns a successful PhaseResult', async () => {
      const runner = makePhaseRunner();
      const executor = makeExecutor();
      const phases: PhaseResult[] = [];

      const result = await runner.runPhase(executor, MOCK_CTX, phases);

      expect(result.success).toBe(true);
      expect(result.phase).toBe(1);
      expect(result.phaseName).toBe('Analysis & Scouting');
    });

    it('pushes result to phases array', async () => {
      const runner = makePhaseRunner();
      const executor = makeExecutor();
      const phases: PhaseResult[] = [];

      await runner.runPhase(executor, MOCK_CTX, phases);

      expect(phases).toHaveLength(1);
      expect(phases[0].success).toBe(true);
    });

    it('calls checkpoint.startPhase then completePhase in order', async () => {
      const checkpoint = makeCheckpoint();
      const runner = makePhaseRunner(makeGateCoordinator(), checkpoint);
      const executor = makeExecutor();

      await runner.runPhase(executor, MOCK_CTX, []);

      const startOrder = (checkpoint.startPhase as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const completeOrder = (checkpoint.completePhase as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(startOrder).toBeLessThan(completeOrder);
    });

    it('calls completePhase with correct phaseId and outputPath', async () => {
      const checkpoint = makeCheckpoint();
      const runner = makePhaseRunner(makeGateCoordinator(), checkpoint);
      const executor = makeExecutor();

      await runner.runPhase(executor, MOCK_CTX, []);

      expect(checkpoint.completePhase).toHaveBeenCalledWith(1, '/tmp/output/analysis.md');
    });

    it('runs the gate after a successful phase', async () => {
      const gateCoordinator = makeGateCoordinator('pass');
      const runner = makePhaseRunner(gateCoordinator);

      await runner.runPhase(makeExecutor(), MOCK_CTX, []);

      expect(gateCoordinator.runGate).toHaveBeenCalledWith(1, expect.any(Array));
    });

    it('does not run gate for phase 5 (out of 1-4 range)', async () => {
      const gateCoordinator = makeGateCoordinator('pass');
      const runner = makePhaseRunner(gateCoordinator);
      const executor = makeExecutor({ phaseId: 5, name: 'PR Composition' });

      await runner.runPhase(executor, MOCK_CTX, []);

      expect(gateCoordinator.runGate).not.toHaveBeenCalled();
    });
  });

  describe('runPhase - gate fail triggers retry', () => {
    it('retries the phase exactly once on gate fail', async () => {
      const gateCoordinator = makeGateCoordinator('fail');
      // After retry, gate passes
      (gateCoordinator.runGate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('fail')
        .mockResolvedValueOnce('pass');

      const runner = makePhaseRunner(gateCoordinator);
      const execute = vi.fn().mockResolvedValue('/tmp/output/analysis.md');
      const executor = makeExecutor({ execute });

      await runner.runPhase(executor, MOCK_CTX, []);

      // execute called twice: initial + retry
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('calls completePhase twice (once after initial, once after retry)', async () => {
      const gateCoordinator = makeGateCoordinator('fail');
      (gateCoordinator.runGate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('fail')
        .mockResolvedValueOnce('pass');

      const checkpoint = makeCheckpoint();
      const runner = makePhaseRunner(gateCoordinator, checkpoint);

      await runner.runPhase(makeExecutor(), MOCK_CTX, []);

      expect(checkpoint.completePhase).toHaveBeenCalledTimes(2);
    });

    it('appends a gate-failed retry event to progressWriter', async () => {
      const gateCoordinator = makeGateCoordinator('fail');
      (gateCoordinator.runGate as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('fail')
        .mockResolvedValueOnce('pass');

      const progressWriter = makeProgressWriter();
      const runner = makePhaseRunner(gateCoordinator, makeCheckpoint(), progressWriter);

      await runner.runPhase(makeExecutor(), MOCK_CTX, []);

      expect(progressWriter.appendEvent).toHaveBeenCalledWith(
        expect.stringContaining('gate failed; retrying phase'),
      );
    });
  });

  describe('runPhase - gate fail after retry aborts', () => {
    it('returns a failure PhaseResult when gate fails after retry', async () => {
      const gateCoordinator = makeGateCoordinator('fail');
      // Both gate checks fail
      (gateCoordinator.runGate as ReturnType<typeof vi.fn>).mockResolvedValue('fail');

      const runner = makePhaseRunner(gateCoordinator);
      const phases: PhaseResult[] = [];

      const result = await runner.runPhase(makeExecutor(), MOCK_CTX, phases);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Gate validation failed for phase 1 after retry');
    });

    it('appends abort event to progressWriter when gate fails after retry', async () => {
      const gateCoordinator = makeGateCoordinator('fail');
      (gateCoordinator.runGate as ReturnType<typeof vi.fn>).mockResolvedValue('fail');

      const progressWriter = makeProgressWriter();
      const runner = makePhaseRunner(gateCoordinator, makeCheckpoint(), progressWriter);

      await runner.runPhase(makeExecutor(), MOCK_CTX, []);

      expect(progressWriter.appendEvent).toHaveBeenCalledWith(
        expect.stringContaining('gate still failing'),
      );
    });
  });

  describe('runPhase - BudgetExceededError propagates', () => {
    it('propagates BudgetExceededError without wrapping', async () => {
      const runner = makePhaseRunner();
      const execute = vi.fn().mockRejectedValue(new BudgetExceededError());
      const executor = makeExecutor({ execute });

      await expect(runner.runPhase(executor, MOCK_CTX, [])).rejects.toThrow(BudgetExceededError);
    });

    it('does not catch BudgetExceededError as a regular failure', async () => {
      const runner = makePhaseRunner();
      const execute = vi.fn().mockRejectedValue(new BudgetExceededError());
      const executor = makeExecutor({ execute });
      const phases: PhaseResult[] = [];

      await expect(runner.runPhase(executor, MOCK_CTX, phases)).rejects.toBeInstanceOf(BudgetExceededError);

      // phases array should still be empty — the error was thrown, not captured
      expect(phases).toHaveLength(0);
    });
  });

  describe('runPhase - phase execution failure (non-budget)', () => {
    it('returns failure PhaseResult without retrying when phase itself fails', async () => {
      const gateCoordinator = makeGateCoordinator('pass');
      const runner = makePhaseRunner(gateCoordinator);
      const execute = vi.fn().mockRejectedValue(new Error('agent crashed'));
      const executor = makeExecutor({ execute });
      const phases: PhaseResult[] = [];

      const result = await runner.runPhase(executor, MOCK_CTX, phases);

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent crashed');
      // Gate should not be called when phase itself fails
      expect(gateCoordinator.runGate).not.toHaveBeenCalled();
    });
  });
});
