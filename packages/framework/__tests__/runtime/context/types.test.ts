import { describe, it, expect } from 'vitest';
import type {
  AgentInvocation,
  AgentResult,
  AgentStep,
  AgentSession,
  TokenUsageDetail,
  GateResult,
  PhaseResult,
  AgentContext,
  WorkUnitId,
  StageIndex,
  WorkUnitInvocation,
  StageResult,
  WorkUnitContext,
} from '../../../src/runtime/context/types.js';

/**
 * These types have no runtime behaviour; tests verify the type contracts are
 * satisfied by representative objects, which also guards against accidental
 * property renames or removals.
 */
describe('Agent runtime types (agent-runtime)', () => {
  it('should satisfy AgentInvocation shape', () => {
    const invocation: AgentInvocation = {
      agent: 'my-agent',
      issueNumber: 1,
      phase: 1,
      contextPath: '/tmp/ctx.json',
      outputPath: '/tmp/out',
    };
    expect(invocation.agent).toBe('my-agent');
    expect(invocation.issueNumber).toBe(1);
    expect(invocation.timeout).toBeUndefined();
    expect(invocation.sessionId).toBeUndefined();
  });

  it('should satisfy AgentResult shape', () => {
    const result: AgentResult = {
      agent: 'my-agent',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 1234,
      stdout: 'done',
      stderr: '',
      tokenUsage: null,
      outputPath: '/tmp/out',
      outputExists: true,
    };
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should satisfy AgentResult with TokenUsageDetail', () => {
    const detail: TokenUsageDetail = { input: 100, output: 200, model: 'gpt-4' };
    const result: AgentResult = {
      agent: 'x',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 0,
      stdout: '',
      stderr: '',
      tokenUsage: detail,
      outputPath: '',
      outputExists: false,
    };
    expect((result.tokenUsage as TokenUsageDetail).model).toBe('gpt-4');
  });

  it('should satisfy AgentStep shape', () => {
    const step: AgentStep = {
      id: 'session-001-step-001',
      name: 'Step one',
      description: 'First step',
      files: ['src/foo.ts'],
      complexity: 'simple',
      acceptanceCriteria: ['It works'],
    };
    expect(step.complexity).toBe('simple');
    expect(step.files).toHaveLength(1);
  });

  it('should accept all complexity values for AgentStep', () => {
    const complexities: AgentStep['complexity'][] = ['simple', 'moderate', 'complex'];
    for (const c of complexities) {
      const step: AgentStep = {
        id: 'id',
        name: 'n',
        description: 'd',
        files: [],
        complexity: c,
        acceptanceCriteria: [],
      };
      expect(step.complexity).toBe(c);
    }
  });

  it('should satisfy AgentSession shape', () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'My session',
      rationale: 'Because',
      dependencies: ['session-000'],
      steps: [],
    };
    expect(session.dependencies).toHaveLength(1);
    expect(session.testable).toBeUndefined();
  });

  it('should allow testable flag on AgentSession', () => {
    const session: AgentSession = {
      id: 's',
      name: 'n',
      rationale: 'r',
      dependencies: [],
      steps: [],
      testable: false,
    };
    expect(session.testable).toBe(false);
  });

  it('should satisfy GateResult shape', () => {
    const gate: GateResult = { status: 'warn', warnings: ['low coverage'], errors: [] };
    expect(gate.status).toBe('warn');
  });

  it('should accept all GateResult status values', () => {
    const statuses: GateResult['status'][] = ['pass', 'warn', 'fail'];
    for (const s of statuses) {
      const g: GateResult = { status: s, warnings: [], errors: [] };
      expect(g.status).toBe(s);
    }
  });

  it('should satisfy PhaseResult shape', () => {
    const phase: PhaseResult = {
      phase: 1,
      phaseName: 'Analysis',
      success: true,
      duration: 500,
      tokenUsage: 1000,
    };
    expect(phase.success).toBe(true);
    expect(phase.gateResult).toBeUndefined();
  });

  it('should satisfy AgentContext shape', () => {
    const ctx: AgentContext = {
      agent: 'my-agent',
      issueNumber: 1,
      projectName: 'test',
      repository: 'owner/repo',
      worktreePath: '/tmp/wt',
      phase: 1,
      config: { commands: { build: 'npm run build' } },
      inputFiles: ['a.json'],
      outputPath: '/tmp/out',
    };
    expect(ctx.agent).toBe('my-agent');
    expect(ctx.sessionId).toBeUndefined();
    expect(ctx.payload).toBeUndefined();
    expect(ctx.outputSchema).toBeUndefined();
  });

  it('should support neutral work-unit/stage aliases', () => {
    const workUnitId: WorkUnitId = 42;
    const stageIndex: StageIndex = 2;

    const invocation: WorkUnitInvocation = {
      agent: 'alias-agent',
      issueNumber: workUnitId,
      phase: stageIndex,
      contextPath: '/tmp/ctx.json',
      outputPath: '/tmp/out.json',
    };

    const result: StageResult = {
      phase: stageIndex,
      phaseName: 'Implementation',
      success: true,
      duration: 120,
      tokenUsage: null,
    };

    const context: WorkUnitContext = {
      agent: 'alias-agent',
      issueNumber: workUnitId,
      projectName: 'demo',
      repository: 'owner/repo',
      worktreePath: '/tmp/wt',
      phase: stageIndex,
      config: { commands: {} },
      inputFiles: [],
      outputPath: '/tmp/out.json',
    };

    expect(invocation.issueNumber).toBe(42);
    expect(result.phase).toBe(2);
    expect(context.phase).toBe(2);
  });
});
