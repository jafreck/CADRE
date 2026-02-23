import { exec } from '../util/process.js';
import { exists } from '../util/fs.js';
import type { PreRunValidator, ValidationResult } from './types.js';
import type { CadreConfig } from '../config/schema.js';

export const agentBackendValidator: PreRunValidator = {
  name: 'agent-backend-validator',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    let cliCommand: string;
    let cliConfigKey: string;

    if (!config.agent || config.agent.backend === 'copilot') {
      cliCommand = config.agent ? config.agent.copilot.cliCommand : config.copilot.cliCommand;
      cliConfigKey = config.agent ? 'agent.copilot.cliCommand' : 'copilot.cliCommand';
    } else {
      cliCommand = config.agent.claude.cliCommand;
      cliConfigKey = 'agent.claude.cliCommand';
    }

    const whichResult = await exec('which', [cliCommand]);
    if (whichResult.exitCode !== 0) {
      errors.push(`CLI command '${cliCommand}' not found on PATH. Install it or set ${cliConfigKey} to the correct command name.`);
    }

    const agentDir = config.copilot.agentDir;
    const agentDirExists = await exists(agentDir);
    if (!agentDirExists) {
      errors.push(`Agent directory '${agentDir}' does not exist. Create it or set copilot.agentDir to a valid path.`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
    };
  },
};
