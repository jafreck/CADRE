import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from '@cadre-dev/framework/core';
import type { RuntimeConfig } from '../config/loader.js';

/**
 * Validates that the Lore CLI is available on PATH when `lore.enabled` is
 * true in the config.  This is a soft warning — the pipeline can still run
 * without Lore, but agents will not benefit from knowledge-base lookups.
 */
export const loreValidator: PreRunValidator = {
  name: 'lore',

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const loreEnabled = config.lore?.enabled ?? false;
    if (!loreEnabled) {
      return { passed: true, errors, warnings };
    }

    const loreCommand = config.lore?.command ?? 'lore';

    const whichResult = await exec('which', [loreCommand]);
    if (whichResult.exitCode !== 0) {
      warnings.push(
        `Lore is enabled but command '${loreCommand}' was not found on PATH. ` +
        `Install @jafreck/lore or disable config.lore.enabled. ` +
        `Agents will fall back to direct file reads.`,
      );
    }

    return {
      passed: true, // Lore is optional — warn but don't block the run.
      errors,
      warnings,
    };
  },
};
