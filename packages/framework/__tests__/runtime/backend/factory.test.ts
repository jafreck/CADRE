import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAgentBackend,
  registerAgentBackendFactory,
  registerAgentBackends,
  unregisterAgentBackendFactory,
  hasAgentBackendFactory,
  listAgentBackendFactories,
  resetAgentBackendFactories,
} from '../../../src/runtime/backend/factory.js';
import { CopilotBackend, ClaudeBackend } from '../../../src/runtime/backend/backend.js';
import type { BackendRuntimeConfig, BackendLoggerLike } from '../../../src/runtime/backend/contract.js';

function makeConfig(backend: string = 'copilot'): BackendRuntimeConfig {
  return {
    agent: {
      backend,
      timeout: 300_000,
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude' },
    },
    environment: { extraPath: [] },
  };
}

function makeLogger(): BackendLoggerLike {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createAgentBackend', () => {
  beforeEach(() => {
    resetAgentBackendFactories();
  });

  it('resets built-in backend factories', () => {
    resetAgentBackendFactories();
    expect(hasAgentBackendFactory('copilot')).toBe(true);
    expect(hasAgentBackendFactory('claude')).toBe(true);
  });

  it('keeps built-in backends registered when custom backend is registered first', () => {
    registerAgentBackendFactory('custom-first', () => ({
      name: 'custom-first',
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

    expect(hasAgentBackendFactory('copilot')).toBe(true);
    expect(hasAgentBackendFactory('claude')).toBe(true);
    expect(hasAgentBackendFactory('custom-first')).toBe(true);
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

  it('supports batch backend registration', () => {
    registerAgentBackends([
      {
        name: 'batch-a',
        factory: () => ({
          name: 'batch-a',
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
        }),
      },
      {
        name: 'batch-b',
        factory: () => ({
          name: 'batch-b',
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
        }),
      },
    ]);

    expect(listAgentBackendFactories()).toEqual(expect.arrayContaining(['batch-a', 'batch-b', 'claude', 'copilot']));
  });

  it('normalizes backend names for registration and selection', () => {
    registerAgentBackendFactory('  custom-normalized  ', () => ({
      name: 'custom-normalized',
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

    const backend = createAgentBackend(makeConfig('  CUSTOM-NORMALIZED  '), makeLogger());
    expect(backend.name).toBe('custom-normalized');
  });

  it('throws for empty backend registration names', () => {
    expect(() => registerAgentBackendFactory('   ', () => ({
      name: 'nope',
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
    }))).toThrow(/must be a non-empty string/);
  });

  it('throws for empty backend selections', () => {
    expect(() => createAgentBackend(makeConfig('   '), makeLogger())).toThrow(/must be a non-empty string/);
  });
});
