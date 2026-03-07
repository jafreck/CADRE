import { describe, it, expect } from 'vitest';
import {
  getAgentBackendOptions,
  normalizeAgentBackendName,
  ensureValidAgentBackendName,
  type BackendRuntimeConfig,
  type AgentInvocationOptions,
} from '../../../src/runtime/backend/contract.js';

function makeConfig(): BackendRuntimeConfig {
  return {
    agent: {
      backend: 'copilot',
      timeout: 300_000,
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude' },
    },
    copilot: { timeout: 300_000 },
    environment: { extraPath: [] },
  };
}

describe('backend contract helpers', () => {
  it('normalizes backend names', () => {
    expect(normalizeAgentBackendName('  CoPiLot  ')).toBe('copilot');
  });

  it('validates backend names', () => {
    expect(() => ensureValidAgentBackendName('  ', 'selection')).toThrow(/must be a non-empty string/);
  });

  it('reads legacy built-in backend options', () => {
    const options = getAgentBackendOptions<{ cliCommand?: string; agentDir?: string }>(makeConfig(), 'copilot');
    expect(options).toEqual({ cliCommand: 'copilot', agentDir: '.github/agents' });
  });

  it('merges generic backend options over legacy options', () => {
    const config = makeConfig();
    config.agent.backends = {
      copilot: {
        cliCommand: 'copilot-enterprise',
      },
    };

    const options = getAgentBackendOptions<{ cliCommand?: string; agentDir?: string }>(config, 'copilot');
    expect(options).toEqual({ cliCommand: 'copilot-enterprise', agentDir: '.github/agents' });
  });

  it('throws when generic backend options are not objects', () => {
    const config = makeConfig();
    config.agent.backends = {
      custom: 'invalid' as unknown as Record<string, unknown>,
    };

    expect(() => getAgentBackendOptions(config, 'custom')).toThrow(/generic options must be an object/);
  });
});

describe('AgentInvocationOptions', () => {
  it('accepts an object with an optional onData field', () => {
    const options: AgentInvocationOptions = {};
    expect(options.onData).toBeUndefined();
  });

  it('accepts onData as a function with chunk and stream parameters', () => {
    const calls: Array<{ chunk: string; stream: string }> = [];
    const options: AgentInvocationOptions = {
      onData: (chunk, stream) => calls.push({ chunk, stream }),
    };
    options.onData?.('hello', 'stdout');
    expect(calls).toEqual([{ chunk: 'hello', stream: 'stdout' }]);
  });

  it('calling onData optionally on an object without onData does not throw', () => {
    const options: AgentInvocationOptions = {};
    expect(() => options.onData?.('hello', 'stdout')).not.toThrow();
  });
});
