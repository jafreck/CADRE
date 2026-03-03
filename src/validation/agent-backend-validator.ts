import { exec } from '../util/process.js';
import { exists } from '../util/fs.js';
import type { PreRunValidator, ValidationResult } from '@cadre/framework/core';
import type { RuntimeConfig } from '../config/loader.js';
import { hasAgentBackendFactory, listAgentBackendFactories } from '../agents/backend-factory.js';

export const agentBackendValidator: PreRunValidator = {
  name: 'agent-backend-validator',

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // loadConfig always returns config.agent with defaults applied
    const agent = config.agent;

    if (!hasAgentBackendFactory(agent.backend)) {
      errors.push(
        `Agent backend "${agent.backend}" is not registered. Registered backends: ${listAgentBackendFactories().join(', ') || '(none)'}.`,
      );
      return { passed: false, errors, warnings };
    }

    const backendKey = agent.backend as keyof typeof agent;
    const backendConfig = (agent[backendKey] as Record<string, unknown> | undefined) ?? undefined;

    const cliCommand = typeof backendConfig?.['cliCommand'] === 'string'
      ? backendConfig['cliCommand']
      : agent.backend === 'claude'
        ? agent.claude.cliCommand
        : agent.copilot.cliCommand;

    const agentDir = typeof backendConfig?.['agentDir'] === 'string'
      ? backendConfig['agentDir']
      : agent.backend === 'claude'
        ? agent.claude.agentDir
        : agent.copilot.agentDir;

    const whichResult = await exec('which', [cliCommand]);
    if (whichResult.exitCode !== 0) {
      warnings.push(
        `CLI command '${cliCommand}' not found on PATH. If backend '${agent.backend}' does not require a local CLI, ignore this warning.`,
      );
    }

    const agentDirExists = await exists(agentDir);
    if (!agentDirExists) {
      warnings.push(
        `Agent directory '${agentDir}' does not exist. If backend '${agent.backend}' stores templates elsewhere, ignore this warning.`,
      );
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
    };
  },
};
