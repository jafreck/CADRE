import type { RuntimeConfig } from '../../../../../src/config/loader.js';
import { statOrNull } from '../../../../../src/util/fs.js';
import { exec } from '../../../../../src/util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export const diskValidator: PreRunValidator<RuntimeConfig> = {
  name: 'disk',

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const repoStat = await statOrNull(config.repoPath);
    if (!repoStat) {
      return { passed: false, errors: [`repoPath does not exist: ${config.repoPath}`], warnings: [] };
    }

    const duResult = await exec('du', ['-sk', config.repoPath]);
    if (duResult.exitCode !== 0) {
      return { passed: false, errors: [`Failed to determine repo size: ${duResult.stderr.trim()}`], warnings: [] };
    }
    const repoSizeKb = parseInt(duResult.stdout.split('\t')[0], 10);
    if (isNaN(repoSizeKb) || repoSizeKb <= 0) {
      return { passed: false, errors: [`Could not parse repo size from du output: ${duResult.stdout.trim()}`], warnings: [] };
    }

    const maxParallelIssues = config.options.maxParallelIssues;
    const estimateKb = repoSizeKb * maxParallelIssues;

    const worktreeRoot = config.worktreeRoot;

    const dfResult = await exec('df', ['-k', worktreeRoot]);
    if (dfResult.exitCode !== 0) {
      const dfFallback = await exec('df', ['-k', config.repoPath]);
      if (dfFallback.exitCode !== 0) {
        return { passed: false, errors: [`Failed to determine available disk space: ${dfFallback.stderr.trim()}`], warnings: [] };
      }
      return evaluateSpace(dfFallback.stdout, estimateKb, errors, warnings);
    }

    return evaluateSpace(dfResult.stdout, estimateKb, errors, warnings);
  },
};

function evaluateSpace(
  dfOutput: string,
  estimateKb: number,
  errors: string[],
  warnings: string[],
): ValidationResult {
  const lines = dfOutput.trim().split('\n');
  const dataLine = lines.slice(1).join(' ').trim();
  const parts = dataLine.split(/\s+/);
  const availableKb = parseInt(parts[3], 10);

  if (isNaN(availableKb)) {
    return { passed: false, errors: [`Could not parse available disk space from df output`], warnings: [] };
  }

  if (availableKb < estimateKb) {
    errors.push(
      `Insufficient disk space: ${formatKb(availableKb)} available, ${formatKb(estimateKb)} required.`,
    );
    return { passed: false, errors, warnings };
  }

  if (availableKb < estimateKb * 2) {
    warnings.push(
      `Low disk space: ${formatKb(availableKb)} available, recommend at least ${formatKb(estimateKb * 2)}.`,
    );
  }

  return { passed: true, errors, warnings };
}

function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}
