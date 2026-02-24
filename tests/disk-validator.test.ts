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
  overrides: Partial<{ repoPath: string; worktreeRoot: string; maxParallelIssues: number }> = {},
) =>
  makeRuntimeConfig({
    repoPath: overrides.repoPath ?? '/tmp/repo',
    ...(overrides.worktreeRoot !== undefined ? { worktreeRoot: overrides.worktreeRoot } : {}),
    ...(overrides.maxParallelIssues !== undefined
      ? { options: { maxParallelIssues: overrides.maxParallelIssues, maxParallelAgents: 3, maxRetriesPerTask: 3, dryRun: false, resume: false, invocationDelayMs: 0, buildVerification: true, testVerification: true, perTaskBuildCheck: true, maxBuildFixRounds: 2, skipValidation: false, maxIntegrationFixRounds: 1, ambiguityThreshold: 5, haltOnAmbiguity: false, respondToReviews: false } }
      : {}),
  });

const okResult = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const failResult = { exitCode: 1, stdout: '', stderr: 'error', signal: null, timedOut: false } as const;

// Build a df -k output line where Available is the 4th field (index 3).
// Format: Filesystem 1K-blocks Used Available Use% Mounted
const makeDfOutput = (availableKb: number): string =>
  `Filesystem     1K-blocks      Used  Available Use% Mounted on\n/dev/disk1s1  1000000000 500000000  ${availableKb}  50% /\n`;

const makeDuOutput = (sizeKb: number): string => `${sizeKb}\t/tmp/repo\n`;

describe('diskValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should expose the name "disk"', () => {
    expect(diskValidator.name).toBe('disk');
  });

  describe('when repoPath does not exist', () => {
    it('should return passed:false with an error', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('repoPath does not exist');
    });

    it('should not call exec when repoPath is absent', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      await diskValidator.validate(makeConfig());

      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe('when du -sk fails', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as ReturnType<typeof statOrNull> extends Promise<infer T> ? T : never);
    });

    it('should return passed:false with an error', async () => {
      vi.mocked(exec).mockResolvedValue({ ...failResult });

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Failed to determine repo size');
    });
  });

  describe('when du output is unparseable', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should return passed:false when du stdout has no numeric first field', async () => {
      vi.mocked(exec).mockResolvedValueOnce({ ...okResult, stdout: 'bad-output\t/tmp/repo\n' });

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Could not parse repo size');
    });

    it('should return passed:false when du reports zero size', async () => {
      vi.mocked(exec).mockResolvedValueOnce({ ...okResult, stdout: '0\t/tmp/repo\n' });

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Could not parse repo size');
    });
  });

  describe('when df -k fails on worktreeRoot and repoPath', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should return passed:false with an error', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(100000) }) // du succeeds
        .mockResolvedValueOnce({ ...failResult }) // df on worktreeRoot fails
        .mockResolvedValueOnce({ ...failResult }); // df on repoPath fallback fails

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Failed to determine available disk space');
    });
  });

  describe('when df -k fails on worktreeRoot but succeeds on repoPath fallback', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should return passed:true using the fallback df result when space is sufficient', async () => {
      const repoSizeKb = 100000;
      const availableKb = repoSizeKb * 3 * 2; // >= 2× estimate (3 parallel by default)

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) }) // du
        .mockResolvedValueOnce({ ...failResult }) // df on worktreeRoot
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) }); // df fallback

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('when df output has unparseable available field', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should return passed:false', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(100000) })
        .mockResolvedValueOnce({ ...okResult, stdout: 'Filesystem\ngarbage line\n' });

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Could not parse available disk space');
    });
  });

  describe('disk space thresholds', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should return passed:false when available < 1× estimate', async () => {
      const repoSizeKb = 100000;
      const maxParallelIssues = 3;
      const estimateKb = repoSizeKb * maxParallelIssues;
      const availableKb = estimateKb - 1;

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('Insufficient disk space');
    });

    it('should return passed:true with warning when available is between 1× and 2× estimate', async () => {
      const repoSizeKb = 100000;
      const maxParallelIssues = 3;
      const estimateKb = repoSizeKb * maxParallelIssues;
      const availableKb = estimateKb + 1; // just above 1× but below 2×

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Low disk space');
    });

    it('should return passed:true with no warnings when available >= 2× estimate', async () => {
      const repoSizeKb = 100000;
      const maxParallelIssues = 3;
      const estimateKb = repoSizeKb * maxParallelIssues;
      const availableKb = estimateKb * 2;

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return passed:true with warning at exactly 2× estimate minus 1', async () => {
      const repoSizeKb = 50000;
      const maxParallelIssues = 2;
      const estimateKb = repoSizeKb * maxParallelIssues;
      const availableKb = estimateKb * 2 - 1;

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('maxParallelIssues default', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should default maxParallelIssues to 3 when not configured', async () => {
      const repoSizeKb = 100000;
      // 3× estimate available → passes with no warning
      const availableKb = repoSizeKb * 3 * 2;

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should use configured maxParallelIssues when set', async () => {
      const repoSizeKb = 100000;
      const maxParallelIssues = 5;
      // Available is exactly 1× estimate for maxParallelIssues=5, but < 2× → warning
      const estimateKb = repoSizeKb * maxParallelIssues;
      const availableKb = estimateKb + 1;

      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(repoSizeKb) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(availableKb) });

      const result = await diskValidator.validate(makeConfig({ maxParallelIssues }));

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('df target path', () => {
    beforeEach(() => {
      vi.mocked(statOrNull).mockResolvedValue({} as any);
    });

    it('should call df on worktreeRoot when configured', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(50000) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(50000 * 3 * 2) });

      await diskValidator.validate(makeConfig({ worktreeRoot: '/custom/worktrees' }));

      expect(exec).toHaveBeenCalledWith('df', ['-k', '/custom/worktrees']);
    });

    it('should call df on the configured worktreeRoot (always set by loadConfig)', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(50000) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(50000 * 3 * 2) });

      const config = makeConfig({ repoPath: '/tmp/myrepo' });
      await diskValidator.validate(config);

      expect(exec).toHaveBeenCalledWith('df', ['-k', config.worktreeRoot]);
    });

    it('should call du on repoPath', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult, stdout: makeDuOutput(50000) })
        .mockResolvedValueOnce({ ...okResult, stdout: makeDfOutput(50000 * 3 * 2) });

      await diskValidator.validate(makeConfig({ repoPath: '/my/repo' }));

      expect(exec).toHaveBeenCalledWith('du', ['-sk', '/my/repo']);
    });

    it('should call statOrNull on repoPath', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      await diskValidator.validate(makeConfig({ repoPath: '/my/special/repo' }));

      expect(statOrNull).toHaveBeenCalledWith('/my/special/repo');
    });
  });
});
