import { describe, it, expect } from 'vitest';
import * as agentRuntime from '../../../packages/agent-runtime/src/index.js';

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
});
