import { describe, it, expect } from 'vitest';
import type {
  AgentInvocation,
  AgentResult,
  AgentStep,
  AgentSession,
  TokenUsageDetail,
  AnalysisResult,
  ScoutReport,
  ReviewResult,
  ReviewIssue,
  IntegrationReport,
  CommandResult,
  PRContent,
  GateResult,
  PhaseResult,
  AgentContext,
} from '../../../../packages/agent-runtime/src/context/types.js';

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

  it('should satisfy AnalysisResult shape', () => {
    const analysis: AnalysisResult = {
      requirements: ['req1'],
      changeType: 'feature',
      scope: 'medium',
      affectedAreas: ['src/'],
      ambiguities: [],
    };
    expect(analysis.changeType).toBe('feature');
  });

  it('should accept all changeType values', () => {
    const types: AnalysisResult['changeType'][] = ['bug-fix', 'feature', 'refactor', 'docs', 'chore'];
    for (const t of types) {
      const a: AnalysisResult = { requirements: [], changeType: t, scope: 'small', affectedAreas: [], ambiguities: [] };
      expect(a.changeType).toBe(t);
    }
  });

  it('should satisfy ScoutReport shape', () => {
    const report: ScoutReport = {
      relevantFiles: [{ path: 'src/index.ts', reason: 'entry' }],
      dependencyMap: { 'a.ts': ['b.ts'] },
      testFiles: ['test.ts'],
      estimatedChanges: [{ path: 'a.ts', linesEstimate: 10 }],
    };
    expect(report.relevantFiles).toHaveLength(1);
  });

  it('should satisfy ReviewResult and ReviewIssue shapes', () => {
    const issue: ReviewIssue = {
      file: 'src/x.ts',
      line: 42,
      severity: 'error',
      description: 'Bad code',
    };
    const review: ReviewResult = {
      verdict: 'needs-fixes',
      issues: [issue],
      summary: 'Fix it',
    };
    expect(review.verdict).toBe('needs-fixes');
    expect(review.issues[0].severity).toBe('error');
  });

  it('should allow ReviewIssue without line number', () => {
    const issue: ReviewIssue = {
      file: 'src/x.ts',
      severity: 'warning',
      description: 'Consider refactoring',
    };
    expect(issue.line).toBeUndefined();
  });

  it('should satisfy IntegrationReport shape', () => {
    const cmd: CommandResult = { command: 'npm test', exitCode: 0, output: 'ok', pass: true };
    const report: IntegrationReport = {
      buildResult: cmd,
      testResult: cmd,
      overallPass: true,
    };
    expect(report.overallPass).toBe(true);
    expect(report.lintResult).toBeUndefined();
  });

  it('should satisfy CommandResult with signal', () => {
    const cmd: CommandResult = {
      command: 'npm build',
      exitCode: null,
      signal: 'SIGTERM',
      output: '',
      pass: false,
    };
    expect(cmd.signal).toBe('SIGTERM');
  });

  it('should satisfy PRContent shape', () => {
    const pr: PRContent = { title: 'Fix bug', body: 'Details', labels: ['bug'] };
    expect(pr.labels).toHaveLength(1);
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
});
