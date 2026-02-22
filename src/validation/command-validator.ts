import type { CadreConfig } from '../config/schema.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export class CommandValidator implements PreRunValidator {
  readonly name = 'commands';

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    const { install, build, test, lint } = config.commands;
    const entries: Array<[string, string | undefined]> = [
      ['install', install],
      ['build', build],
      ['test', test],
      ['lint', lint],
    ];

    for (const [label, command] of entries) {
      if (!command) continue;

      const executable = command.trim().split(/\s+/)[0];
      const result = await exec('which', [executable]);
      if (result.exitCode !== 0) {
        errors.push(`Command executable for "${label}" not found on PATH: ${executable}`);
      }
    }

    return { passed: errors.length === 0, warnings, errors, name: this.name };
  }
}
