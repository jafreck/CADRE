import { exec } from '../util/process.js';
import { exists } from '../util/fs.js';
import type { PreRunValidator, ValidationResult } from './types.js';
import type { CadreConfig } from '../config/schema.js';

export const agentBackendValidator: PreRunValidator = {
  name: 'agent-backend-validator',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // loadConfig always synthesizes config.agent before returning
    const agent = config.agent!;
    const isClaudeBackend = agent.backend === 'claude';

    const cliCommand = isClaudeBackend ? agent.claude.cliCommand : agent.copilot.cliCommand;
    const cliConfigKey = isClaudeBackend ? 'agent.claude.cliCommand' : 'agent.copilot.cliCommand';

    const whichResult = await exec('which', [cliCommand]);
    if (whichResult.exitCode !== 0) {
      errors.push(`CLI command '${cliCommand}' not found on PATH. Install it or set ${cliConfigKey} to the correct command name.`);
    }

    const agentDir = isClaudeBackend ? agent.claude.agentDir : agent.copilot.agentDir;
    const agentDirKey = isClaudeBackend ? 'agent.claude.agentDir' : 'agent.copilot.agentDir';
    const agentDirExists = await exists(agentDir);
    if (!agentDirExists) {
      errors.push(`Agent directory '${agentDir}' does not exist. Create it or set ${agentDirKey} to a valid path.`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
    };
  },
};
