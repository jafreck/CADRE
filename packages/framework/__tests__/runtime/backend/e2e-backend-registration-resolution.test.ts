import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentBackend,
  hasAgentBackendFactory,
  listAgentBackendFactories,
  registerAgentBackendFactory,
  resetAgentBackendFactories,
  unregisterAgentBackendFactory,
  type AgentBackend,
  type BackendLoggerLike,
  type BackendRuntimeConfig,
} from '../../../src/index.ts';

function makeConfig(backend: string): BackendRuntimeConfig {
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
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('backend registration/resolution e2e (framework public api)', () => {
  beforeEach(() => {
    resetAgentBackendFactories();
  });

  it('keeps built-ins available and resolves a custom backend selection', async () => {
    expect(hasAgentBackendFactory('copilot')).toBe(true);
    expect(hasAgentBackendFactory('claude')).toBe(true);
    expect(listAgentBackendFactories()).toEqual(expect.arrayContaining(['copilot', 'claude']));

    const logger = makeLogger();

    const copilotBackend = createAgentBackend(makeConfig('copilot'), logger);
    const claudeBackend = createAgentBackend(makeConfig('claude'), logger);

    expect(copilotBackend.name).toBe('copilot');
    expect(claudeBackend.name).toBe('claude');

    let initialized = false;

    registerAgentBackendFactory('  Custom-E2E  ', (): AgentBackend => ({
      name: 'custom-e2e',
      init: async () => {
        initialized = true;
      },
      invoke: async (invocation) => ({
        agent: invocation.agent,
        success: true,
        exitCode: 0,
        timedOut: false,
        duration: 0,
        stdout: 'ok',
        stderr: '',
        tokenUsage: 0,
        outputPath: invocation.outputPath,
        outputExists: true,
      }),
    }));

    expect(hasAgentBackendFactory('custom-e2e')).toBe(true);
    expect(listAgentBackendFactories()).toEqual(expect.arrayContaining(['copilot', 'claude', 'custom-e2e']));

    const customBackend = createAgentBackend(makeConfig('  CUSTOM-E2E  '), logger);
    expect(customBackend.name).toBe('custom-e2e');
    await customBackend.init();
    expect(initialized).toBe(true);

    unregisterAgentBackendFactory('custom-e2e');
    expect(hasAgentBackendFactory('custom-e2e')).toBe(false);
    expect(hasAgentBackendFactory('copilot')).toBe(true);
    expect(hasAgentBackendFactory('claude')).toBe(true);
  });
});
