import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import { listFilesRecursive } from '../util/fs.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

async function getRepoSizeBytes(repoPath: string): Promise<number> {
  const files = await listFilesRecursive(repoPath);
  let total = 0;
  for (const file of files) {
    try {
      const s = await stat(join(repoPath, file));
      total += s.size;
    } catch {
      // skip unreadable files
    }
  }
  return total;
}

async function getFreeSpaceBytes(repoPath: string): Promise<number | null> {
  // Use `df -k` for portable free space check (works on macOS and Linux)
  const result = await exec('df', ['-k', repoPath]);
  if (result.exitCode !== 0) return null;

  const lines = result.stdout.trim().split('\n');
  // Last line has the actual disk info; columns: Filesystem, 1K-blocks, Used, Available, ...
  const dataLine = lines[lines.length - 1];
  const parts = dataLine.trim().split(/\s+/);
  // On Linux: Filesystem 1K-blocks Used Available Use% Mounted
  // On macOS:  Filesystem 512-blocks Used Available Capacity iused ifree %iused Mounted
  // We need "Available" column — index 3 on both
  const availableKb = parseInt(parts[3], 10);
  if (isNaN(availableKb)) return null;

  // `df -k` reports in 1K blocks
  return availableKb * 1024;
}

export class DiskValidator implements PreRunValidator {
  readonly name = 'disk';

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    const maxParallelIssues = config.options.maxParallelIssues;

    let repoSize: number;
    try {
      repoSize = await getRepoSizeBytes(config.repoPath);
    } catch {
      warnings.push('Could not determine repository size for disk space check.');
      return { passed: true, warnings, errors, name: this.name };
    }

    const estimated = repoSize * maxParallelIssues;

    const freeSpace = await getFreeSpaceBytes(config.repoPath);
    if (freeSpace === null) {
      warnings.push('Could not determine available disk space.');
      return { passed: true, warnings, errors, name: this.name };
    }

    if (freeSpace < estimated) {
      const freeMB = (freeSpace / 1024 / 1024).toFixed(1);
      const estimatedMB = (estimated / 1024 / 1024).toFixed(1);
      errors.push(
        `Insufficient disk space: ${freeMB} MB free, ~${estimatedMB} MB estimated needed (repoSize × maxParallelIssues=${maxParallelIssues}).`,
      );
      return { passed: false, warnings, errors, name: this.name };
    }

    if (freeSpace < estimated * 2) {
      const freeMB = (freeSpace / 1024 / 1024).toFixed(1);
      const estimatedMB = (estimated / 1024 / 1024).toFixed(1);
      warnings.push(
        `Low disk headroom: ${freeMB} MB free, ~${estimatedMB} MB estimated needed. Consider freeing up space.`,
      );
    }

    return { passed: true, warnings, errors, name: this.name };
  }
}
