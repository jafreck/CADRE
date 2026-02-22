import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { gitValidator } from '../src/validation/git-validator.js';

const makeConfig = (overrides: Partial<{ repoPath: string; baseBranch: string }> = {}): CadreConfig =>
  ({
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: overrides.repoPath ?? '/tmp/repo',
    baseBranch: overrides.baseBranch ?? 'main',
    issues: { ids: [1] },
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
  }) as unknown as CadreConfig;

const okResult = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const failResult = { exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const timedOutResult = { exitCode: null, stdout: '', stderr: '', signal: null, timedOut: true } as const;

describe('gitValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should expose the name "git"', () => {
    expect(gitValidator.name).toBe('git');
  });

  describe('when .git directory is absent', () => {
    it('should return passed:false immediately', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('No .git directory');
    });

    it('should not call exec when .git is absent', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      await gitValidator.validate(makeConfig());

      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe('when .git directory exists', () => {
    beforeEach(() => {
      vi.mocked(exists).mockResolvedValue(true);
    });

    it('should return passed:false when baseBranch does not exist locally', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...failResult }) // rev-parse fails
        .mockResolvedValue({ ...okResult });

      const result = await gitValidator.validate(makeConfig({ baseBranch: 'missing-branch' }));

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('missing-branch');
    });

    it('should return passed:true with no warnings when repo is clean and remote reachable', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult }) // rev-parse
        .mockResolvedValueOnce({ ...okResult, stdout: '' }) // git status (clean)
        .mockResolvedValueOnce({ ...okResult }); // ls-remote

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return passed:true with warning when there are uncommitted changes', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult }) // rev-parse
        .mockResolvedValueOnce({ ...okResult, stdout: ' M src/foo.ts\n' }) // git status (dirty)
        .mockResolvedValueOnce({ ...okResult }); // ls-remote

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('uncommitted changes'))).toBe(true);
    });

    it('should return passed:true with warning when remote is unreachable', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult }) // rev-parse
        .mockResolvedValueOnce({ ...okResult, stdout: '' }) // git status (clean)
        .mockResolvedValueOnce({ ...failResult }); // ls-remote fails (not timed out)

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('unreachable'))).toBe(true);
    });

    it('should return passed:true with warning when remote check times out', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult }) // rev-parse
        .mockResolvedValueOnce({ ...okResult, stdout: '' }) // git status (clean)
        .mockResolvedValueOnce({ ...timedOutResult }); // ls-remote timed out

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('timed out'))).toBe(true);
    });

    it('should include both uncommitted-changes and unreachable warnings together', async () => {
      vi.mocked(exec)
        .mockResolvedValueOnce({ ...okResult }) // rev-parse
        .mockResolvedValueOnce({ ...okResult, stdout: 'M  file.ts\n' }) // dirty
        .mockResolvedValueOnce({ ...failResult }); // ls-remote fails

      const result = await gitValidator.validate(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(2);
    });

    it('should call rev-parse with the configured baseBranch', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });

      await gitValidator.validate(makeConfig({ baseBranch: 'develop' }));

      expect(exec).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--verify', 'develop'],
        expect.objectContaining({ cwd: '/tmp/repo' }),
      );
    });

    it('should check existence of .git inside repoPath', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });

      await gitValidator.validate(makeConfig({ repoPath: '/custom/repo' }));

      expect(exists).toHaveBeenCalledWith('/custom/repo/.git');
    });
  });
});
