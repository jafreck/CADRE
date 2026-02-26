import { describe, it, expect } from 'vitest';
import type { AgentContext, GateResult, PhaseResult, SessionReviewSummary } from '../src/agents/types.js';

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

describe('AgentContext outputSchema field', () => {
  const baseContext: AgentContext = {
    agent: 'issue-analyst',
    issueNumber: 42,
    projectName: 'my-project',
    repository: 'owner/repo',
    worktreePath: '/tmp/worktree',
    phase: 1,
    config: { commands: { build: 'npm run build', test: 'npm test' } },
    inputFiles: [],
    outputPath: '/tmp/output.md',
  };

  it('should accept AgentContext without outputSchema (backward compatible)', () => {
    const ctx: AgentContext = { ...baseContext };
    expect(ctx.outputSchema).toBeUndefined();
  });

  it('should accept AgentContext with outputSchema set to an empty object', () => {
    const ctx: AgentContext = { ...baseContext, outputSchema: {} };
    expect(ctx.outputSchema).toBeDefined();
    expect(ctx.outputSchema).toEqual({});
  });

  it('should accept AgentContext with a JSON Schema object as outputSchema', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        summary: { type: 'string' },
      },
      required: ['verdict', 'summary'],
    };
    const ctx: AgentContext = { ...baseContext, outputSchema: schema };
    expect(ctx.outputSchema).toBeDefined();
    expect(ctx.outputSchema?.['type']).toBe('object');
    expect(ctx.outputSchema?.['required']).toEqual(['verdict', 'summary']);
  });

  it('should accept outputSchema with nested properties', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    };
    const ctx: AgentContext = { ...baseContext, outputSchema: schema };
    expect(ctx.outputSchema?.['properties']).toBeDefined();
  });

  it('should preserve all other AgentContext fields when outputSchema is set', () => {
    const ctx: AgentContext = {
      ...baseContext,
      taskId: 'task-001',
      outputSchema: { type: 'object' },
    };
    expect(ctx.agent).toBe('issue-analyst');
    expect(ctx.issueNumber).toBe(42);
    expect(ctx.projectName).toBe('my-project');
    expect(ctx.taskId).toBe('task-001');
    expect(ctx.outputSchema).toEqual({ type: 'object' });
  });
});

describe('SessionReviewSummary', () => {
  it('should accept a passing review summary with key findings', () => {
    const summary: SessionReviewSummary = {
      sessionId: 'session-001',
      verdict: 'pass',
      summary: 'All changes look correct.',
      keyFindings: ['No regressions', 'Tests pass'],
    };
    expect(summary.sessionId).toBe('session-001');
    expect(summary.verdict).toBe('pass');
    expect(summary.keyFindings).toHaveLength(2);
  });

  it('should accept a needs-fixes verdict', () => {
    const summary: SessionReviewSummary = {
      sessionId: 'session-002',
      verdict: 'needs-fixes',
      summary: 'Several issues found.',
      keyFindings: ['Missing null check on line 42'],
    };
    expect(summary.verdict).toBe('needs-fixes');
  });

  it('should accept empty keyFindings array', () => {
    const summary: SessionReviewSummary = {
      sessionId: 'session-003',
      verdict: 'pass',
      summary: 'No findings.',
      keyFindings: [],
    };
    expect(summary.keyFindings).toHaveLength(0);
  });

  it('should only allow valid verdict values at runtime', () => {
    const validVerdicts = ['pass', 'needs-fixes'];
    for (const verdict of validVerdicts) {
      const summary: SessionReviewSummary = {
        sessionId: 'session-001',
        verdict: verdict as SessionReviewSummary['verdict'],
        summary: 'Test',
        keyFindings: [],
      };
      expect(validVerdicts).toContain(summary.verdict);
    }
  });
});
