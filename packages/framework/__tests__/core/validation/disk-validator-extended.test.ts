import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/runtime/commands/exec.js', () => ({
  exec: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

import { exec } from '../../../src/runtime/commands/exec.js';
import { stat } from 'node:fs/promises';
import { diskValidator, type DiskValidatorConfig } from '../../../src/core/validation/disk-validator.js';

const makeConfig = (
  overrides: Partial<{ repoPath: string; maxParallelIssues: number }> = {},
): DiskValidatorConfig => ({
  repoPath: overrides.repoPath ?? '/tmp/repo',
  worktreeRoot: '/tmp/.cadre/worktrees',
  options: { maxParallelIssues: overrides.maxParallelIssues ?? 3 },
});

const ok = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: 'error', signal: null, timedOut: false } as const;

const makeDfOutput = (availableKb: number): string =>
  `Filesystem     1K-blocks      Used  Available Use% Mounted on\n/dev/disk1s1  1000000000 500000000  ${availableKb}  50% /\n`;

const makeDuOutput = (sizeKb: number): string => `${sizeKb}\t/tmp/repo\n`;

describe('validation-disk', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(stat).mockResolvedValue({} as any);
  });

  it('returns passed:false with error when disk space is insufficient', async () => {
    const repoSizeKb = 100_000;
    const maxParallelIssues = 3;
    const estimateKb = repoSizeKb * maxParallelIssues;
    const availableKb = estimateKb - 1; // less than required

    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok, stdout: makeDuOutput(repoSizeKb) })
      .mockResolvedValueOnce({ ...ok, stdout: makeDfOutput(availableKb) });

    const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('Insufficient disk space'))).toBe(true);
  });

  it('returns passed:true with warning when disk space is low but sufficient', async () => {
    const repoSizeKb = 100_000;
    const maxParallelIssues = 3;
    const estimateKb = repoSizeKb * maxParallelIssues;
    const availableKb = estimateKb + 1; // above 1× but below 2×

    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok, stdout: makeDuOutput(repoSizeKb) })
      .mockResolvedValueOnce({ ...ok, stdout: makeDfOutput(availableKb) });

    const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes('Low disk space'))).toBe(true);
  });

  it('returns passed:true with no warnings when disk space is sufficient', async () => {
    const repoSizeKb = 100_000;
    const maxParallelIssues = 3;
    const estimateKb = repoSizeKb * maxParallelIssues;
    const availableKb = estimateKb * 2; // at 2× threshold — no warning

    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok, stdout: makeDuOutput(repoSizeKb) })
      .mockResolvedValueOnce({ ...ok, stdout: makeDfOutput(availableKb) });

    const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns passed:false when repoPath does not exist', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

    const result = await diskValidator.validate(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('repoPath does not exist');
    expect(exec).not.toHaveBeenCalled();
  });
});
