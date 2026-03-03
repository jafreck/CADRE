import type { AgentContextDescriptor, AgentName, AgentDefinition } from './types.js';
import { AGENT_DEFINITIONS } from './types.js';
import { AGENT_CONTEXT_REGISTRY } from './context-builder.js';

export interface RegisteredAgent {
  name: AgentName;
  definition: AgentDefinition;
  context: AgentContextDescriptor;
  defaults: {
    phase: number;
    templateFile: string;
  };
}

export function defineAgent(input: {
  definition: AgentDefinition;
  context: AgentContextDescriptor;
  defaults?: Partial<RegisteredAgent['defaults']>;
}): RegisteredAgent {
  return {
    name: input.definition.name,
    definition: input.definition,
    context: input.context,
    defaults: {
      phase: input.defaults?.phase ?? input.definition.phase,
      templateFile: input.defaults?.templateFile ?? input.definition.templateFile,
    },
  };
}

const DEFAULT_REGISTERED_AGENTS: RegisteredAgent[] = AGENT_DEFINITIONS
  .map((definition) => {
    const context = AGENT_CONTEXT_REGISTRY[definition.name];
    if (!context) {
      return null;
    }
    return defineAgent({ definition, context });
  })
  .filter((agent): agent is RegisteredAgent => agent !== null);

const REGISTRY = new Map<AgentName, RegisteredAgent>(
  DEFAULT_REGISTERED_AGENTS.map((agent) => [agent.name, agent]),
);

export function registerAgent(agent: RegisteredAgent): void {
  REGISTRY.set(agent.name, agent);
}

export function unregisterAgent(name: AgentName): void {
  REGISTRY.delete(name);
}

export function getRegisteredAgent(name: AgentName): RegisteredAgent | undefined {
  return REGISTRY.get(name);
}

export function listRegisteredAgents(): readonly RegisteredAgent[] {
  return [...REGISTRY.values()];
}

export function getAgentContextDescriptor(name: AgentName): AgentContextDescriptor | undefined {
  return REGISTRY.get(name)?.context;
}

export function resetRegisteredAgents(): void {
  REGISTRY.clear();
  for (const agent of DEFAULT_REGISTERED_AGENTS) {
    REGISTRY.set(agent.name, agent);
  }
}
