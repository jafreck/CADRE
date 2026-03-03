import {
  ensureValidAgentBackendName,
  type BackendFactory,
  type BackendRuntimeConfig,
  type BackendLoggerLike,
  type AgentBackend,
} from './contract.js';
import { CopilotBackend, ClaudeBackend } from './backend.js';

export type { BackendFactory, BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from './contract.js';

export interface AgentBackendRegistration {
  name: string;
  factory: BackendFactory;
}

const backendFactories = new Map<string, BackendFactory>();

function ensureBuiltInBackendsRegistered(): void {
  if (!backendFactories.has('copilot')) {
    registerAgentBackendFactory('copilot', (config, logger) => new CopilotBackend(config, logger));
  }
  if (!backendFactories.has('claude')) {
    registerAgentBackendFactory('claude', (config, logger) => new ClaudeBackend(config, logger));
  }
}

export function registerAgentBackendFactory(name: string, factory: BackendFactory): void {
  const normalized = ensureValidAgentBackendName(name, 'registration name');
  if (typeof factory !== 'function') {
    throw new Error(`Agent backend factory for "${normalized}" must be a function.`);
  }
  backendFactories.set(normalized, factory);
}

export function registerAgentBackends(registrations: readonly AgentBackendRegistration[]): void {
  for (const registration of registrations) {
    registerAgentBackendFactory(registration.name, registration.factory);
  }
}

export function unregisterAgentBackendFactory(name: string): void {
  backendFactories.delete(ensureValidAgentBackendName(name, 'unregistration name'));
}

export function hasAgentBackendFactory(name: string): boolean {
  ensureBuiltInBackendsRegistered();
  return backendFactories.has(ensureValidAgentBackendName(name, 'lookup name'));
}

export function listAgentBackendFactories(): string[] {
  ensureBuiltInBackendsRegistered();
  return [...backendFactories.keys()].sort();
}

export function resetAgentBackendFactories(): void {
  backendFactories.clear();
  ensureBuiltInBackendsRegistered();
}

/**
 * Creates and returns the appropriate agent backend based on `config.agent.backend`.
 */
export function createAgentBackend(config: BackendRuntimeConfig, logger: BackendLoggerLike): AgentBackend {
  ensureBuiltInBackendsRegistered();

  const backend = ensureValidAgentBackendName(config.agent.backend, 'selection');
  const factory = backendFactories.get(backend);
  if (!factory) {
    const available = listAgentBackendFactories();
    throw new Error(
      `Unknown agent backend: "${config.agent.backend}". Registered backends: ${available.join(', ') || '(none)'}.`,
    );
  }
  return factory(config, logger);
}
