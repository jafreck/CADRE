import type { CadreConfig } from "../config/schema.js";
import { exec } from "../util/process.js";
import { exists } from "../util/fs.js";
import type { PreRunValidator, ValidationResult } from "./types.js";

export const agentBackendValidator: PreRunValidator = {
  name: 'agent-backend',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const cliCommand = config.copilot.cliCommand;
    const result = await exec('which', [cliCommand]);
    if (result.exitCode !== 0) {
      errors.push(`CLI command '${cliCommand}' not found on PATH`);
    }

    const agentDir = config.copilot.agentDir;
    const agentDirExists = await exists(agentDir);
    if (!agentDirExists) {
      errors.push(`Agent directory '${agentDir}' does not exist`);
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
    };
  },
};
