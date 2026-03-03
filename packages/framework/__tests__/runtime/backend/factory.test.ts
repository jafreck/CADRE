import { describe, it, expect, vi } from 'vitest';
import {
  createAgentBackend,
  registerAgentBackendFactory,
  unregisterAgentBackendFactory,
  hasAgentBackendFactory,
  resetAgentBackendFactories,
} from '../../../src/runtime/backend/factory.js';
import { CopilotBackend, ClaudeBackend, type BackendRuntimeConfig, type BackendLoggerLike } from '../../../src/runtime/backend/backend.js';

function makeConfig(backend: string = 'copilot'): BackendRuntimeConfig {
  return {
    agent: {
      backend,
      timeout: 300_000,
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude' },
    },
    copilot: { timeout: 300_000 },
    environment: { extraPath: [] },
  };
}

function makeLogger(): BackendLoggerLike {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createAgentBackend', () => {
  it('resets built-in backend factories', () => {
    resetAgentBackendFactories();
    expect(hasAgentBackendFactory('copilot')).toBe(true);
    expect(hasAgentBackendFactory('claude')).toBe(true);
  });

  it('should return CopilotBackend for backend "copilot"', () => {
    const backend = createAgentBackend(makeConfig('copilot'), makeLogger());
    expect(backend).toBeInstanceOf(CopilotBackend);
    expect(backend.name).toBe('copilot');
  });

  it('should return ClaudeBackend for backend "claude"', () => {
    const backend = createAgentBackend(makeConfig('claude'), makeLogger());
    expect(backend).toBeInstanceOf(ClaudeBackend);
    expect(backend.name).toBe('claude');
  });

  it('should throw for unknown backend', () => {
    expect(() => createAgentBackend(makeConfig('unknown'), makeLogger())).toThrow(
      /Unknown agent backend.*"unknown"/,
    );
  });

  it('should allow registering and unregistering custom backend factories', () => {
    registerAgentBackendFactory('custom', () => ({
      name: 'custom',
      init: async () => {},
      invoke: async () => ({
        agent: 'issue-analyst',
        success: true,
        exitCode: 0,
        timedOut: false,
        duration: 0,
        stdout: '',
        stderr: '',
        tokenUsage: 0,
        outputPath: '',
        outputExists: true,
      }),
    }));

    expect(hasAgentBackendFactory('custom')).toBe(true);
    expect(createAgentBackend(makeConfig('custom'), makeLogger()).name).toBe('custom');

    unregisterAgentBackendFactory('custom');
    expect(hasAgentBackendFactory('custom')).toBe(false);
  });
});
