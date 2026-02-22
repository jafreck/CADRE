import { join } from 'node:path';
import type { CadreConfig } from '../config/schema.js';
import { exists } from '../util/fs.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export class GitValidator implements PreRunValidator {
  readonly name = 'git-validator';

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check .git directory exists
    const gitDir = join(config.repoPath, '.git');
    if (!(await exists(gitDir))) {
      errors.push(`No .git directory found at ${config.repoPath}. Is this a git repository?`);
      return { passed: false, warnings, errors, name: this.name };
    }

    // Check baseBranch exists locally
    const branchResult = await exec('git', ['rev-parse', '--verify', config.baseBranch], {
      cwd: config.repoPath,
    });
    if (branchResult.exitCode !== 0) {
      errors.push(`Base branch "${config.baseBranch}" does not exist locally.`);
      return { passed: false, warnings, errors, name: this.name };
    }

    // Warn if working tree is dirty
    const statusResult = await exec('git', ['status', '--porcelain'], {
      cwd: config.repoPath,
    });
    if (statusResult.exitCode === 0 && statusResult.stdout.trim().length > 0) {
      warnings.push('Working tree has uncommitted changes.');
    }

    // Warn if remote is unreachable (non-blocking)
    const remoteResult = await exec('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], {
      cwd: config.repoPath,
      timeout: 10_000,
    });
    if (remoteResult.exitCode !== 0 || remoteResult.timedOut) {
      warnings.push('Remote "origin" is unreachable. Some operations may fail.');
    }

    return { passed: true, warnings, errors, name: this.name };
  }
}
