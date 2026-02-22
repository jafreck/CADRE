import { join } from 'node:path';
import type { CadreConfig } from '../config/schema.js';
import { statOrNull } from '../util/fs.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export const diskValidator: PreRunValidator = {
  name: 'disk',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify repoPath exists before running du
    const repoStat = await statOrNull(config.repoPath);
    if (!repoStat) {
      return { passed: false, errors: [`repoPath does not exist: ${config.repoPath}`], warnings: [] };
    }

    // Get repo size in KB using du -sk
    const duResult = await exec('du', ['-sk', config.repoPath]);
    if (duResult.exitCode !== 0) {
      return { passed: false, errors: [`Failed to determine repo size: ${duResult.stderr.trim()}`], warnings: [] };
    }
    const repoSizeKb = parseInt(duResult.stdout.split('\t')[0], 10);
    if (isNaN(repoSizeKb) || repoSizeKb <= 0) {
      return { passed: false, errors: [`Could not parse repo size from du output: ${duResult.stdout.trim()}`], warnings: [] };
    }

    const maxParallelIssues = config.options?.maxParallelIssues ?? 3;
    const estimateKb = repoSizeKb * maxParallelIssues;

    // Use worktreeRoot for df; fall back to repoPath if not set
    const worktreeRoot = config.worktreeRoot ?? join(config.repoPath, '.cadre', 'worktrees');

    // Get available disk space in KB using df -k
    const dfResult = await exec('df', ['-k', worktreeRoot]);
    if (dfResult.exitCode !== 0) {
      // Fall back to repoPath if worktreeRoot doesn't exist yet
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
  // df -k output: Filesystem 1K-blocks Used Available Use% Mounted
  const lines = dfOutput.trim().split('\n');
  // The data line may wrap, so join non-header lines
  const dataLine = lines.slice(1).join(' ').trim();
  const parts = dataLine.split(/\s+/);
  // Available is the 4th field (index 3) on standard df output
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
