import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import { exists } from '../util/fs.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export const gitValidator: PreRunValidator = {
  name: 'git',

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cwd = config.repoPath;

    // Check .git directory exists
    const gitDir = join(cwd, '.git');
    if (!(await exists(gitDir))) {
      return { passed: false, errors: [`No .git directory found at ${cwd}`], warnings: [] };
    }

    // Check baseBranch exists locally
    const revParse = await exec('git', ['rev-parse', '--verify', config.baseBranch], { cwd });
    if (revParse.exitCode !== 0) {
      errors.push(`Base branch '${config.baseBranch}' does not exist locally.`);
      return { passed: false, errors, warnings };
    }

    // Warn on uncommitted changes
    const status = await exec('git', ['status', '--porcelain'], { cwd });
    if (status.exitCode === 0 && status.stdout.trim().length > 0) {
      warnings.push('There are uncommitted changes in the repository.');
    }

    // Warn if remote is unreachable
    const lsRemote = await exec('git', ['ls-remote', '--exit-code', '--heads', 'origin'], {
      cwd,
      timeout: 10_000,
    });
    if (lsRemote.exitCode !== 0 && !lsRemote.timedOut) {
      warnings.push('Remote origin is unreachable. Continuing with local state only.');
    } else if (lsRemote.timedOut) {
      warnings.push('Remote origin check timed out. Continuing with local state only.');
    }

    return { passed: true, errors, warnings };
  },
};
