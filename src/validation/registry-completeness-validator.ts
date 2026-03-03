import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeConfig } from '../config/loader.js';
import { exists } from '../util/fs.js';
import { AGENT_CONTEXT_REGISTRY } from '../agents/context-builder.js';
import { listRegisteredAgents } from '../agents/registry.js';
import type { PreRunValidator, ValidationResult } from '@cadre/framework/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const registryCompletenessValidator: PreRunValidator = {
  name: 'registry-completeness',

  async validate(_config: RuntimeConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const templatesDir = join(__dirname, '..', 'agents', 'templates');
    const registeredAgents = listRegisteredAgents();

    for (const { definition: agent } of registeredAgents) {
      // Check template file existence
      const templatePath = join(templatesDir, agent.templateFile);
      if (!(await exists(templatePath))) {
        errors.push(
          `Agent "${agent.name}" references template file "${agent.templateFile}" which does not exist in src/agents/templates/`,
        );
      }

      // Check AGENT_CONTEXT_REGISTRY membership
      if (!(agent.name in AGENT_CONTEXT_REGISTRY)) {
        errors.push(
          `Agent "${agent.name}" is defined in AGENT_DEFINITIONS but has no entry in AGENT_CONTEXT_REGISTRY`,
        );
      }

      // Check outputSchema for structured-output agents
      if (agent.hasStructuredOutput && agent.name in AGENT_CONTEXT_REGISTRY) {
        const descriptor = AGENT_CONTEXT_REGISTRY[agent.name];
        if (!descriptor.outputSchema) {
          errors.push(
            `Agent "${agent.name}" has hasStructuredOutput: true but its AGENT_CONTEXT_REGISTRY entry lacks an outputSchema`,
          );
        }
      }
    }

    // Keep compatibility check: AGENT_DEFINITIONS entries should still be discoverable via the registry map.
    for (const agentName of Object.keys(AGENT_CONTEXT_REGISTRY)) {
      if (!registeredAgents.find((entry) => entry.name === agentName)) {
        errors.push(
          `Agent "${agentName}" exists in AGENT_CONTEXT_REGISTRY but is not discoverable via the defineAgent registry`,
        );
      }
    }

    return { passed: errors.length === 0, errors, warnings };
  },
};
