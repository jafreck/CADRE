import { describe, it, expect, vi } from 'vitest';
import { createAgentBackend } from '../../../../packages/agent-runtime/src/backend/factory.js';
import { CopilotBackend, ClaudeBackend, type BackendRuntimeConfig, type BackendLoggerLike } from '../../../../packages/agent-runtime/src/backend/backend.js';

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
});
