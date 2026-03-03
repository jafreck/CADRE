import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  spawnProcess: vi.fn(),
  stripVSCodeEnv: vi.fn((env: Record<string, string | undefined>) => ({ ...env })),
  trackProcess: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  ensureDir: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));

import { CopilotBackend, ClaudeBackend } from '../src/agents/backend.js';
import {
  createAgentBackend,
  registerAgentBackendFactory,
  unregisterAgentBackendFactory,
  hasAgentBackendFactory,
  resetAgentBackendFactories,
} from '../src/agents/backend-factory.js';

function makeConfig(backend: 'copilot' | 'claude' | string = 'copilot') {
  return makeRuntimeConfig({
    agent: {
      backend: backend as 'copilot' | 'claude',
      copilot: {
        cliCommand: 'copilot',
        agentDir: '.github/agents',
      },
      claude: {
        cliCommand: 'claude',
        agentDir: '/tmp/.cadre/test-project/agents',
      },
    },
  });
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

describe('createAgentBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentBackendFactories();
  });

  it('returns a CopilotBackend when config.agent.backend is "copilot"', () => {
    const config = makeConfig('copilot');
    const backend = createAgentBackend(config, makeLogger());
    expect(backend).toBeInstanceOf(CopilotBackend);
  });

  it('returns a ClaudeBackend when config.agent.backend is "claude"', () => {
    const config = makeConfig('claude');
    const backend = createAgentBackend(config, makeLogger());
    expect(backend).toBeInstanceOf(ClaudeBackend);
  });

  it('returns a CopilotBackend when config.agent.backend is omitted (defaults to "copilot")', () => {
    const config = makeConfig('copilot');
    const backend = createAgentBackend(config, makeLogger());
    expect(backend).toBeInstanceOf(CopilotBackend);
  });

  it('throws a descriptive error for an unknown backend value', () => {
    const config = makeConfig('unsupported-backend');
    expect(() => createAgentBackend(config, makeLogger())).toThrow(
      /Unknown agent backend.*"unsupported-backend"/,
    );
  });

  it('thrown error for unknown backend mentions valid options', () => {
    const config = makeConfig('gpt4');
    expect(() => createAgentBackend(config, makeLogger())).toThrow(/Registered backends: .*copilot.*claude|Registered backends: .*claude.*copilot/i);
  });

  it('returned CopilotBackend has name "copilot"', () => {
    const config = makeConfig('copilot');
    const backend = createAgentBackend(config, makeLogger());
    expect(backend.name).toBe('copilot');
  });

  it('returned ClaudeBackend has name "claude"', () => {
    const config = makeConfig('claude');
    const backend = createAgentBackend(config, makeLogger());
    expect(backend.name).toBe('claude');
  });

  it('returned backend exposes init() and invoke() methods', () => {
    const config = makeConfig('copilot');
    const backend = createAgentBackend(config, makeLogger());
    expect(typeof backend.init).toBe('function');
    expect(typeof backend.invoke).toBe('function');
  });

  it('supports registering a custom backend factory', () => {
    const customInit = vi.fn().mockResolvedValue(undefined);
    const customInvoke = vi.fn();

    registerAgentBackendFactory('custom', () => ({
      name: 'custom',
      init: customInit,
      invoke: customInvoke,
    }));

    const backend = createAgentBackend(makeConfig('custom'), makeLogger());
    expect(backend.name).toBe('custom');
    expect(hasAgentBackendFactory('custom')).toBe(true);

    unregisterAgentBackendFactory('custom');
    expect(hasAgentBackendFactory('custom')).toBe(false);
  });
});
