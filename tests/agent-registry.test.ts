import { describe, it, expect, beforeEach } from 'vitest';
import {
  defineAgent,
  getRegisteredAgent,
  listRegisteredAgents,
  registerAgent,
  unregisterAgent,
  resetRegisteredAgents,
} from '../src/agents/registry.js';
import type { AgentContextDescriptor } from '../src/agents/types.js';

const descriptor: AgentContextDescriptor = {
  phase: 0,
  outputFile: () => '/tmp/out.md',
  inputFiles: async () => [],
};

describe('agent registry', () => {
  beforeEach(() => {
    resetRegisteredAgents();
  });

  it('defineAgent creates normalized registration defaults', () => {
    const registration = defineAgent({
      definition: {
        name: 'conflict-resolver',
        phase: 0,
        phaseName: 'Orchestration',
        description: 'Resolve conflicts',
        hasStructuredOutput: false,
        templateFile: 'conflict-resolver.md',
      },
      context: descriptor,
    });

    expect(registration.name).toBe('conflict-resolver');
    expect(registration.defaults.phase).toBe(0);
    expect(registration.defaults.templateFile).toBe('conflict-resolver.md');
  });

  it('supports runtime registration and lookup', () => {
    const registration = defineAgent({
      definition: {
        name: 'conflict-resolver',
        phase: 0,
        phaseName: 'Orchestration',
        description: 'Resolve conflicts',
        hasStructuredOutput: false,
        templateFile: 'conflict-resolver.md',
      },
      context: descriptor,
    });

    registerAgent(registration);

    expect(getRegisteredAgent('conflict-resolver')).toBeDefined();
    expect(listRegisteredAgents().find((entry) => entry.name === 'conflict-resolver')).toBeDefined();

    unregisterAgent('conflict-resolver');
    expect(getRegisteredAgent('conflict-resolver')).toBeUndefined();
  });
});
