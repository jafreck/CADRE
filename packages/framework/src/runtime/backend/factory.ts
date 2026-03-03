import type { BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from './backend.js';
import { CopilotBackend, ClaudeBackend } from './backend.js';

export type BackendFactory = (config: BackendRuntimeConfig, logger: BackendLoggerLike) => AgentBackend;

const backendFactories = new Map<string, BackendFactory>();

function normalizeBackendName(name: string): string {
  return name.trim().toLowerCase();
}

function ensureBuiltInBackendsRegistered(): void {
  if (backendFactories.size > 0) {
    return;
  }
  registerAgentBackendFactory('copilot', (config, logger) => new CopilotBackend(config, logger));
  registerAgentBackendFactory('claude', (config, logger) => new ClaudeBackend(config, logger));
}

export function registerAgentBackendFactory(name: string, factory: BackendFactory): void {
  backendFactories.set(normalizeBackendName(name), factory);
}

export function unregisterAgentBackendFactory(name: string): void {
  backendFactories.delete(normalizeBackendName(name));
}

export function hasAgentBackendFactory(name: string): boolean {
  ensureBuiltInBackendsRegistered();
  return backendFactories.has(normalizeBackendName(name));
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

  const backend = normalizeBackendName(config.agent.backend);
  const factory = backendFactories.get(backend);
  if (!factory) {
    const available = listAgentBackendFactories();
    throw new Error(
      `Unknown agent backend: "${config.agent.backend}". Registered backends: ${available.join(', ') || '(none)'}.`,
    );
  }
  return factory(config, logger);
}
