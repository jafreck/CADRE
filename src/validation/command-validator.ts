import type { CadreConfig } from '../config/schema.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export const commandValidator: PreRunValidator = {
  name: 'command',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const requiredCommands: Array<{ name: string; value: string | undefined }> = [
      { name: 'build', value: config.commands?.build },
      { name: 'test', value: config.commands?.test },
    ];

    const optionalCommands: Array<{ name: string; value: string | undefined }> = [
      { name: 'install', value: config.commands?.install },
      { name: 'lint', value: config.commands?.lint },
    ];

    for (const cmd of [...requiredCommands, ...optionalCommands]) {
      if (!cmd.value) continue;

      const executable = cmd.value.trim().split(/\s+/)[0];
      const result = await exec('which', [executable]);
      if (result.exitCode !== 0) {
        errors.push(`Executable '${executable}' for commands.${cmd.name} not found on PATH.`);
      }
    }

    return { passed: errors.length === 0, errors, warnings };
  },
};
