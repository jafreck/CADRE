import type { RuntimeConfig } from '../config/loader.js';
import type { Logger } from '../logging/logger.js';
import { type AgentBackend, CopilotBackend, ClaudeBackend } from './backend.js';

/**
 * Creates and returns the appropriate agent backend based on `config.agent.backend`.
 */
export function createAgentBackend(config: RuntimeConfig, logger: Logger): AgentBackend {
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
