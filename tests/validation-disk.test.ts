import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  listFilesRecursive: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { listFilesRecursive } from '../src/util/fs.js';
import { stat } from 'node:fs/promises';
import { DiskValidator } from '../src/validation/disk-validator.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

const mockExec = vi.mocked(exec);
const mockListFiles = vi.mocked(listFilesRecursive);
const mockStat = vi.mocked(stat);

function makeDfResult(availableKb: number) {
  return {
    exitCode: 0,
    stdout: `Filesystem  1K-blocks  Used Available Use% Mounted\n/dev/disk1  100000000 5000000  ${availableKb}  50% /`,
    stderr: '',
    signal: null,
    timedOut: false,
  };
}

describe('DiskValidator', () => {
  let validator: DiskValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new DiskValidator();
    // 3 files × 1 MB = 3 MB repo; maxParallelIssues=3 → estimated 9 MB
    mockListFiles.mockResolvedValue(['file1.ts', 'file2.ts', 'file3.ts']);
    mockStat.mockResolvedValue({ size: 1024 * 1024 } as Awaited<ReturnType<typeof stat>>);
  });

  it('should pass with no warnings when free space is well above the estimate', async () => {
    mockExec.mockResolvedValue(makeDfResult(100 * 1024)); // 100 MB free

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should fail when free space is less than the estimate', async () => {
    mockExec.mockResolvedValue(makeDfResult(5 * 1024)); // 5 MB free < 9 MB estimated

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should warn (but pass) when free space is between 1× and 2× the estimate', async () => {
    mockExec.mockResolvedValue(makeDfResult(12 * 1024)); // 12 MB free, 9–18 MB range

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should warn (but pass) when df command fails', async () => {
    mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'df error', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
