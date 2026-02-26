import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GateCoordinator } from '../src/core/gate-coordinator.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { IssueProgressWriter } from '../src/core/progress.js';
import type { Logger } from '../src/logging/logger.js';
import type { PhaseResult, GateResult } from '../src/agents/types.js';

// ── Hoisted mock functions ────────────────────────────────────────────────────

const {
  mockGate1Validate,
  mockGate1AmbiguityValidate,
} = vi.hoisted(() => ({
  mockGate1Validate: vi.fn(),
  mockGate1AmbiguityValidate: vi.fn(),
}));

// Mock phase-registry to control which gates are present
vi.mock('../src/core/phase-registry.js', () => ({
  buildGateMap: () => ({
    1: { validate: mockGate1Validate },
  }),
  buildRegistry: vi.fn(() => ({ getAll: vi.fn().mockReturnValue([]) })),
  getPhase: vi.fn(),
}));

// Mock AnalysisAmbiguityGate constructor
vi.mock('../src/core/phase-gate.js', () => ({
  AnalysisAmbiguityGate: vi.fn().mockImplementation(() => ({
    validate: mockGate1AmbiguityValidate,
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCheckpoint(): CheckpointManager {
  return {
    recordGateResult: vi.fn().mockResolvedValue(undefined),
  } as unknown as CheckpointManager;
}

function makeProgressWriter(): IssueProgressWriter {
  return {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as IssueProgressWriter;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePhaseResult(overrides: Partial<PhaseResult> = {}): PhaseResult {
  return {
    phase: 1,
    phaseName: 'Analysis & Scouting',
    success: true,
    duration: 1000,
    tokenUsage: 0,
    ...overrides,
  };
}

function makeGateCoordinator(
  checkpoint = makeCheckpoint(),
  progressWriter = makeProgressWriter(),
  logger = makeLogger(),
): GateCoordinator {
  return new GateCoordinator(
    checkpoint,
    progressWriter,
    logger,
    { ambiguityThreshold: 5, haltOnAmbiguity: false },
    '/tmp/progress',
    '/tmp/worktree',
    'abc123',
    42,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GateCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runGate', () => {
    it('returns pass when no gate is registered for the phase', async () => {
      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult({ phase: 5 })];

      const result = await coordinator.runGate(5, phases);

      expect(result).toBe('pass');
    });

    it('returns pass when gate validates successfully', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult()];

      const result = await coordinator.runGate(1, phases);

      expect(result).toBe('pass');
    });

    it('returns warn when gate returns warnings', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'warn', errors: [], warnings: ['missing optional field'] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult()];

      const result = await coordinator.runGate(1, phases);

      expect(result).toBe('warn');
    });

    it('returns fail when gate returns errors', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'fail', errors: ['missing required field'], warnings: [] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult()];

      const result = await coordinator.runGate(1, phases);

      expect(result).toBe('fail');
    });

    it('merges ambiguity gate result for phase 1', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({
        status: 'fail',
        errors: ['too many ambiguities'],
        warnings: [],
      } satisfies GateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult()];

      const result = await coordinator.runGate(1, phases);

      expect(result).toBe('fail');
    });

    it('merges warnings from both gates for phase 1', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'warn', errors: [], warnings: ['warn-from-gate'] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'warn', errors: [], warnings: ['ambiguity-warn'] } satisfies GateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult()];

      const result = await coordinator.runGate(1, phases);

      // Combined status is warn when only warnings are present
      expect(result).toBe('warn');
      // gateResult on the phase entry should contain both warnings
      expect(phases[0].gateResult?.warnings).toEqual(['warn-from-gate', 'ambiguity-warn']);
    });

    it('records gate result on CheckpointManager', async () => {
      const passResult: GateResult = { status: 'pass', errors: [], warnings: [] };
      mockGate1Validate.mockResolvedValue(passResult);
      mockGate1AmbiguityValidate.mockResolvedValue(passResult);

      const checkpoint = makeCheckpoint();
      const coordinator = makeGateCoordinator(checkpoint);
      const phases: PhaseResult[] = [makePhaseResult()];

      await coordinator.runGate(1, phases);

      expect(checkpoint.recordGateResult).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'pass' }));
    });

    it('updates the last phases entry with gateResult', async () => {
      const gateResult: GateResult = { status: 'pass', errors: [], warnings: [] };
      mockGate1Validate.mockResolvedValue(gateResult);
      mockGate1AmbiguityValidate.mockResolvedValue(gateResult);

      const coordinator = makeGateCoordinator();
      const phases: PhaseResult[] = [makePhaseResult(), makePhaseResult({ phase: 2 })];

      await coordinator.runGate(1, phases);

      // Should update the LAST entry in phases
      expect(phases[1].gateResult).toBeDefined();
      expect(phases[0].gateResult).toBeUndefined();
    });

    it('appends a pass event to progressWriter', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const progressWriter = makeProgressWriter();
      const coordinator = makeGateCoordinator(makeCheckpoint(), progressWriter);
      const phases: PhaseResult[] = [makePhaseResult()];

      await coordinator.runGate(1, phases);

      expect(progressWriter.appendEvent).toHaveBeenCalledWith('Gate phase 1: passed');
    });

    it('appends a warning event to progressWriter when status is warn', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'warn', errors: [], warnings: ['w1'] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const progressWriter = makeProgressWriter();
      const coordinator = makeGateCoordinator(makeCheckpoint(), progressWriter);
      const phases: PhaseResult[] = [makePhaseResult()];

      await coordinator.runGate(1, phases);

      expect(progressWriter.appendEvent).toHaveBeenCalledWith(
        expect.stringContaining('passed with 1 warning(s)'),
      );
    });

    it('appends a fail event to progressWriter when status is fail', async () => {
      mockGate1Validate.mockResolvedValue({ status: 'fail', errors: ['bad output'], warnings: [] } satisfies GateResult);
      mockGate1AmbiguityValidate.mockResolvedValue({ status: 'pass', errors: [], warnings: [] } satisfies GateResult);

      const progressWriter = makeProgressWriter();
      const coordinator = makeGateCoordinator(makeCheckpoint(), progressWriter);
      const phases: PhaseResult[] = [makePhaseResult()];

      await coordinator.runGate(1, phases);

      expect(progressWriter.appendEvent).toHaveBeenCalledWith(
        expect.stringContaining('Gate phase 1 failed: bad output'),
      );
    });
  });

  describe('readAmbiguities', () => {
    it('returns empty array when analysis.md is missing', async () => {
      const coordinator = makeGateCoordinator();
      const result = await coordinator.readAmbiguities();
      expect(result).toEqual([]);
    });
  });
});
