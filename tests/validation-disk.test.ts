import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  statOrNull: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { statOrNull } from '../src/util/fs.js';
import { diskValidator } from '../src/validation/disk-validator.js';

const makeConfig = (
  overrides: Partial<{ repoPath: string; maxParallelIssues: number }> = {},
) =>
  makeRuntimeConfig({
    repoPath: overrides.repoPath ?? '/tmp/repo',
    ...(overrides.maxParallelIssues !== undefined
      ? { options: { maxParallelIssues: overrides.maxParallelIssues, maxParallelAgents: 3, maxRetriesPerTask: 3, dryRun: false, resume: false, invocationDelayMs: 0, buildVerification: true, testVerification: true, perTaskBuildCheck: true, maxBuildFixRounds: 2, skipValidation: false, maxIntegrationFixRounds: 1, ambiguityThreshold: 5, haltOnAmbiguity: false, respondToReviews: false } }
      : {}),
  });

const ok = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: 'error', signal: null, timedOut: false } as const;

const makeDfOutput = (availableKb: number): string =>
  `Filesystem     1K-blocks      Used  Available Use% Mounted on\n/dev/disk1s1  1000000000 500000000  ${availableKb}  50% /\n`;

const makeDuOutput = (sizeKb: number): string => `${sizeKb}\t/tmp/repo\n`;

describe('validation-disk', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(statOrNull).mockResolvedValue({} as any);
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
    vi.mocked(statOrNull).mockResolvedValue(null);

    const result = await diskValidator.validate(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('repoPath does not exist');
    expect(exec).not.toHaveBeenCalled();
  });
});
