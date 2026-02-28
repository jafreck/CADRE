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
});
