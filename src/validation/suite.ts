import type { CadreConfig } from '../config/schema.js';
import { agentBackendValidator } from './agent-backend-validator.js';
import { CommandValidator } from './command-validator.js';
import { DiskValidator } from './disk-validator.js';
import { GitValidator } from './git-validator.js';
import { platformValidator } from './platform-validator.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export interface SuiteResult {
  passed: boolean;
  warningCount: number;
  results: Map<string, ValidationResult>;
}

export class PreRunValidationSuite {
  private validators: PreRunValidator[] = [
    platformValidator,
    new GitValidator(),
    new CommandValidator(),
    new DiskValidator(),
    agentBackendValidator,
  ];

  async run(config: CadreConfig): Promise<SuiteResult> {
    const results = new Map<string, ValidationResult>();
    let passed = true;
    let warningCount = 0;

    for (const validator of this.validators) {
      const result = await validator.validate(config);
      results.set(validator.name, result);
      if (!result.passed) {
        passed = false;
      }
      warningCount += result.warnings.length;
    }

    return { passed, warningCount, results };
  }

  formatResults(result: SuiteResult): string {
    const lines: string[] = [];

    for (const [name, vResult] of result.results) {
      let icon: string;
      if (!vResult.passed) {
        icon = '❌';
      } else if (vResult.warnings.length > 0) {
        icon = '⚠️';
      } else {
        icon = '✅';
      }
      lines.push(`${icon} ${name}`);
      for (const err of vResult.errors) {
        lines.push(`   Error: ${err}`);
      }
      for (const warn of vResult.warnings) {
        lines.push(`   Warning: ${warn}`);
      }
    }

    const status = result.passed ? 'PASS' : 'FAIL';
    const summary =
      result.warningCount > 0
        ? `${status} (${result.warningCount} warning${result.warningCount === 1 ? '' : 's'})`
        : status;
    lines.push(summary);

    return lines.join('\n');
  }
}
