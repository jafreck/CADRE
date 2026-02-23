import { describe, it, expect } from 'vitest';
import type { GateResult, PhaseResult } from '../src/agents/types.js';

describe('GateResult', () => {
  it('should accept status pass with empty arrays', () => {
    const result: GateResult = { status: 'pass', warnings: [], errors: [] };
    expect(result.status).toBe('pass');
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept status warn with warning messages', () => {
    const result: GateResult = {
      status: 'warn',
      warnings: ['Token budget at 80%', 'One retry occurred'],
      errors: [],
    };
    expect(result.status).toBe('warn');
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContain('Token budget at 80%');
    expect(result.errors).toHaveLength(0);
  });

  it('should accept status fail with error messages', () => {
    const result: GateResult = {
      status: 'fail',
      warnings: [],
      errors: ['Build failed', 'Tests failed with exit code 1'],
    };
    expect(result.status).toBe('fail');
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('Build failed');
    expect(result.warnings).toHaveLength(0);
  });

  it('should accept both warnings and errors simultaneously', () => {
    const result: GateResult = {
      status: 'fail',
      warnings: ['Slow test detected'],
      errors: ['Lint check failed'],
    };
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('should only allow valid status values at runtime', () => {
    const validStatuses = ['pass', 'warn', 'fail'];
    for (const status of validStatuses) {
      const result: GateResult = {
        status: status as GateResult['status'],
        warnings: [],
        errors: [],
      };
      expect(validStatuses).toContain(result.status);
    }
  });
});

describe('PhaseResult with gateResult', () => {
  const basePhaseResult: Omit<PhaseResult, 'gateResult'> = {
    phase: 1,
    phaseName: 'Analysis',
    success: true,
    duration: 5000,
    tokenUsage: 1234,
  };

  it('should accept PhaseResult without gateResult (backward compatible)', () => {
    const result: PhaseResult = { ...basePhaseResult };
    expect(result.gateResult).toBeUndefined();
  });

  it('should accept PhaseResult with a passing gateResult', () => {
    const result: PhaseResult = {
      ...basePhaseResult,
      gateResult: { status: 'pass', warnings: [], errors: [] },
    };
    expect(result.gateResult).toBeDefined();
    expect(result.gateResult?.status).toBe('pass');
  });

  it('should accept PhaseResult with a warning gateResult', () => {
    const result: PhaseResult = {
      ...basePhaseResult,
      gateResult: { status: 'warn', warnings: ['High token usage'], errors: [] },
    };
    expect(result.gateResult?.status).toBe('warn');
    expect(result.gateResult?.warnings).toContain('High token usage');
  });

  it('should accept PhaseResult with a failing gateResult', () => {
    const result: PhaseResult = {
      ...basePhaseResult,
      success: false,
      gateResult: { status: 'fail', warnings: [], errors: ['Integration check failed'] },
    };
    expect(result.success).toBe(false);
    expect(result.gateResult?.status).toBe('fail');
    expect(result.gateResult?.errors).toContain('Integration check failed');
  });

  it('should preserve all other PhaseResult fields when gateResult is present', () => {
    const result: PhaseResult = {
      ...basePhaseResult,
      outputPath: '/tmp/output.md',
      error: undefined,
      gateResult: { status: 'pass', warnings: [], errors: [] },
    };
    expect(result.phase).toBe(1);
    expect(result.phaseName).toBe('Analysis');
    expect(result.duration).toBe(5000);
    expect(result.tokenUsage).toBe(1234);
    expect(result.outputPath).toBe('/tmp/output.md');
  });
});
