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
  // options.maxParallelIssues defaults to 3
});

const mockExec = vi.mocked(exec);
const mockListFilesRecursive = vi.mocked(listFilesRecursive);
const mockStat = vi.mocked(stat);

function makeDfOutput(availableKb: number): string {
  return `Filesystem  1K-blocks    Used Available Use% Mounted\n/dev/disk1  100000000 5000000  ${availableKb}  50% /`;
}

function makeDfResult(availableKb: number) {
  return { exitCode: 0, stdout: makeDfOutput(availableKb), stderr: '', signal: null, timedOut: false };
}

const dfFailure = { exitCode: 1, stdout: '', stderr: 'df: No such file', signal: null, timedOut: false };

describe('DiskValidator', () => {
  let validator: DiskValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new DiskValidator();
    // Default: 3 files of 1 MB each = 3 MB repo size
    // maxParallelIssues = 3 (default), so estimated = 9 MB
    mockListFilesRecursive.mockResolvedValue(['file1.ts', 'file2.ts', 'file3.ts']);
    mockStat.mockResolvedValue({ size: 1024 * 1024 } as Awaited<ReturnType<typeof stat>>);
  });

  it('should have name "disk"', () => {
    expect(validator.name).toBe('disk');
  });

  it('should return name "disk" in the result', async () => {
    // repoSize = 3 MB, estimated = 9 MB, free = 100 MB → sufficient
    mockExec.mockResolvedValue(makeDfResult(100 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.name).toBe('disk');
  });

  it('should pass with no warnings when free space is well above 2× the estimate', async () => {
    // repoSize = 3 MB, maxParallelIssues = 3, estimated = 9 MB
    // free = 100 MB >> 2 × 9 MB → no warnings
    mockExec.mockResolvedValue(makeDfResult(100 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should pass with a warning when free space is between 1× and 2× the estimate', async () => {
    // repoSize = 3 MB, maxParallelIssues = 3, estimated = 9 MB
    // free = 12 MB → between 9 MB and 18 MB → low headroom warning
    mockExec.mockResolvedValue(makeDfResult(12 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Low disk headroom');
  });

  it('should fail when free space is less than the estimate', async () => {
    // repoSize = 3 MB, maxParallelIssues = 3, estimated = 9 MB
    // free = 5 MB < 9 MB → fail
    mockExec.mockResolvedValue(makeDfResult(5 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Insufficient disk space');
  });

  it('should include free MB and estimated MB in the error message', async () => {
    // repoSize = 3 MB, estimated = 9 MB, free = 5 MB
    mockExec.mockResolvedValue(makeDfResult(5 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.errors[0]).toMatch(/\d+\.\d+ MB free/);
    expect(result.errors[0]).toMatch(/~\d+\.\d+ MB estimated needed/);
  });

  it('should mention maxParallelIssues in the error message', async () => {
    mockExec.mockResolvedValue(makeDfResult(5 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.errors[0]).toContain('maxParallelIssues=3');
  });

  it('should include free MB and estimated MB in the low-headroom warning', async () => {
    mockExec.mockResolvedValue(makeDfResult(12 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.warnings[0]).toMatch(/\d+\.\d+ MB free/);
    expect(result.warnings[0]).toMatch(/~\d+\.\d+ MB estimated needed/);
  });

  it('should scale estimate by maxParallelIssues', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      options: { maxParallelIssues: 1 },
    });
    // repoSize = 3 MB, maxParallelIssues = 1, estimated = 3 MB
    // free = 4 MB → between 3 MB and 6 MB → low headroom (not fail)
    mockExec.mockResolvedValue(makeDfResult(4 * 1024));

    const result = await validator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('should pass with a warning when df command fails', async () => {
    mockExec.mockResolvedValue(dfFailure);

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('available disk space');
  });

  it('should pass with a warning when df output is malformed', async () => {
    mockExec.mockResolvedValue({
      exitCode: 0,
      stdout: 'Filesystem\nnotanumber',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('available disk space');
  });

  it('should pass with a warning when listFilesRecursive throws', async () => {
    mockListFilesRecursive.mockRejectedValue(new Error('Permission denied'));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('repository size');
  });

  it('should call df with the configured repoPath', async () => {
    mockExec.mockResolvedValue(makeDfResult(100 * 1024));

    await validator.validate(baseConfig);

    expect(mockExec).toHaveBeenCalledWith('df', ['-k', '/tmp/repo']);
  });

  it('should call listFilesRecursive with the configured repoPath', async () => {
    mockExec.mockResolvedValue(makeDfResult(100 * 1024));

    await validator.validate(baseConfig);

    expect(mockListFilesRecursive).toHaveBeenCalledWith('/tmp/repo');
  });

  it('should handle a repo with zero files and pass', async () => {
    mockListFilesRecursive.mockResolvedValue([]);
    // repoSize = 0, estimated = 0, free = anything ≥ 0 → pass
    mockExec.mockResolvedValue(makeDfResult(1024));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should skip unreadable files when computing repo size', async () => {
    mockListFilesRecursive.mockResolvedValue(['readable.ts', 'unreadable.ts']);
    mockStat
      .mockResolvedValueOnce({ size: 1024 * 1024 } as Awaited<ReturnType<typeof stat>>)
      .mockRejectedValueOnce(new Error('EACCES'));
    // repoSize = 1 MB (only readable file counted), estimated = 3 MB
    // free = 100 MB → pass
    mockExec.mockResolvedValue(makeDfResult(100 * 1024));

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
