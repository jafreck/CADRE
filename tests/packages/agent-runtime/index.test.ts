import { describe, it, expect } from 'vitest';
import * as agentRuntime from '../../../packages/agent-runtime/src/index.js';
import type {
  TokenSummary,
  TokenUsageDetail,
  GateResult,
  PhaseResult,
  AgentSession,
  AgentStep,
} from '../../../packages/agent-runtime/src/index.js';

describe('agent-runtime barrel exports', () => {
  it('should export TokenTracker class', () => {
    expect(agentRuntime.TokenTracker).toBeDefined();
    expect(typeof agentRuntime.TokenTracker).toBe('function');
  });

  it('should allow instantiation of TokenTracker from barrel', () => {
    const tracker = new agentRuntime.TokenTracker();
    tracker.record(1, 'agent', 1, 100);
    expect(tracker.getTotal()).toBe(100);
  });

  it('should export extractCadreJson function', () => {
    expect(agentRuntime.extractCadreJson).toBeDefined();
    expect(typeof agentRuntime.extractCadreJson).toBe('function');
  });

  it('should export extractCadreJsonWithError function', () => {
    expect(agentRuntime.extractCadreJsonWithError).toBeDefined();
    expect(typeof agentRuntime.extractCadreJsonWithError).toBe('function');
  });

  it('should parse cadre-json via barrel export', () => {
    const result = agentRuntime.extractCadreJson('```cadre-json\n{"ok": true}\n```');
    expect(result).toEqual({ ok: true });
  });

  // session-002 exports
  it('should export RetryExecutor class', () => {
    expect(agentRuntime.RetryExecutor).toBeDefined();
    expect(typeof agentRuntime.RetryExecutor).toBe('function');
  });

  it('should export CopilotBackend class', () => {
    expect(agentRuntime.CopilotBackend).toBeDefined();
    expect(typeof agentRuntime.CopilotBackend).toBe('function');
  });

  it('should export ClaudeBackend class', () => {
    expect(agentRuntime.ClaudeBackend).toBeDefined();
    expect(typeof agentRuntime.ClaudeBackend).toBe('function');
  });

  it('should export isCopilotCliInvocationError function', () => {
    expect(agentRuntime.isCopilotCliInvocationError).toBeDefined();
    expect(typeof agentRuntime.isCopilotCliInvocationError).toBe('function');
  });

  it('should export createAgentBackend function', () => {
    expect(agentRuntime.createAgentBackend).toBeDefined();
    expect(typeof agentRuntime.createAgentBackend).toBe('function');
  });

  it('should export AgentLauncher class', () => {
    expect(agentRuntime.AgentLauncher).toBeDefined();
    expect(typeof agentRuntime.AgentLauncher).toBe('function');
  });

  it('should export launchWithRetry function', () => {
    expect(agentRuntime.launchWithRetry).toBeDefined();
    expect(typeof agentRuntime.launchWithRetry).toBe('function');
  });

  // session-004: verify type exports used by consumer import migrations
  it('should export TokenSummary-compatible shape from getSummary()', () => {
    const tracker = new agentRuntime.TokenTracker();
    tracker.record(1, 'code-writer', 3, 500, 200, 300);
    const summary: TokenSummary = tracker.getSummary();
    expect(summary.total).toBe(500);
    expect(summary.byAgent).toEqual({ 'code-writer': 500 });
    expect(summary.byIssue).toEqual({ 1: 500 });
    expect(summary.byPhase).toEqual({ 3: 500 });
    expect(summary.recordCount).toBe(1);
  });

  it('should satisfy TokenUsageDetail interface shape', () => {
    const detail: TokenUsageDetail = { input: 100, output: 200, model: 'gpt-4' };
    expect(detail.input).toBe(100);
    expect(detail.output).toBe(200);
    expect(detail.model).toBe('gpt-4');
  });

  it('should satisfy GateResult interface shape', () => {
    const gate: GateResult = { status: 'pass', warnings: [], errors: [] };
    expect(gate.status).toBe('pass');
    expect(gate.warnings).toEqual([]);
    expect(gate.errors).toEqual([]);
  });

  it('should satisfy PhaseResult interface shape', () => {
    const result: PhaseResult = {
      phase: 1,
      phaseName: 'analysis',
      success: true,
      duration: 1234,
      tokenUsage: { input: 10, output: 20, model: 'gpt-4' },
      gateResult: { status: 'pass', warnings: [], errors: [] },
    };
    expect(result.phase).toBe(1);
    expect(result.success).toBe(true);
    expect(result.gateResult?.status).toBe('pass');
  });

  it('should satisfy AgentSession interface shape', () => {
    const step: AgentStep = {
      id: 'session-001-step-001',
      name: 'Step 1',
      description: 'First step',
      files: ['src/foo.ts'],
      complexity: 'simple',
      acceptanceCriteria: ['compiles'],
    };
    const session: AgentSession = {
      id: 'session-001',
      name: 'Session 1',
      rationale: 'Testing',
      dependencies: [],
      steps: [step],
    };
    expect(session.id).toBe('session-001');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].complexity).toBe('simple');
  });
});
