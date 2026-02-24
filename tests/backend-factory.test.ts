import { describe, it, expect, vi } from 'vitest';
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
import { createAgentBackend } from '../src/agents/backend-factory.js';

function makeConfig(backend: string = 'copilot') {
  return makeRuntimeConfig({
    agent: {
      backend: backend as 'copilot' | 'claude',
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude', agentDir: '/tmp/.cadre/test-project/agents' },
    },
  });
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

describe('createAgentBackend', () => {
  it('returns an instance with name "copilot" for backend: "copilot"', () => {
    const backend = createAgentBackend(makeConfig('copilot'), makeLogger());
    expect(backend).toBeInstanceOf(CopilotBackend);
    expect(backend.name).toBe('copilot');
  });

  it('returns an instance with name "claude" for backend: "claude"', () => {
    const backend = createAgentBackend(makeConfig('claude'), makeLogger());
    expect(backend).toBeInstanceOf(ClaudeBackend);
    expect(backend.name).toBe('claude');
  });

  it('throws a descriptive Error for an unknown backend string', () => {
    expect(() => createAgentBackend(makeConfig('unknown-backend'), makeLogger())).toThrow(
      /Unknown agent backend.*"unknown-backend"/,
    );
  });
});
