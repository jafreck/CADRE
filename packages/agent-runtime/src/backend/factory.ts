import type { BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from './backend.js';
import { CopilotBackend, ClaudeBackend } from './backend.js';

/**
 * Creates and returns the appropriate agent backend based on `config.agent.backend`.
 */
export function createAgentBackend(config: BackendRuntimeConfig, logger: BackendLoggerLike): AgentBackend {
  const backend = config.agent.backend;

  switch (backend) {
    case 'copilot':
      return new CopilotBackend(config, logger);
    case 'claude':
      return new ClaudeBackend(config, logger);
    default:
      throw new Error(`Unknown agent backend: "${backend}". Expected "copilot" or "claude".`);
  }
}
