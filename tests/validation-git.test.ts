import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { gitValidator } from '../src/validation/git-validator.js';

const makeConfig = () => makeRuntimeConfig({ repoPath: '/tmp/repo' });

const ok = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const timedOut = { exitCode: null, stdout: '', stderr: '', signal: null, timedOut: true } as const;

describe('validation-git', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns passed:false when .git directory is missing', async () => {
    vi.mocked(exists).mockResolvedValue(false);

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('No .git directory');
  });

  it('returns passed:false when base branch does not exist locally', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...fail }) // rev-parse fails
      .mockResolvedValue({ ...ok });

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('does not exist locally');
  });

  it('returns passed:true with uncommitted-changes warning', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok }) // rev-parse
      .mockResolvedValueOnce({ ...ok, stdout: 'M  src/foo.ts\n' }) // status dirty
      .mockResolvedValueOnce({ ...ok }); // ls-remote

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes('uncommitted changes'))).toBe(true);
  });

  it('returns passed:true with unreachable-remote warning', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok }) // rev-parse
      .mockResolvedValueOnce({ ...ok, stdout: '' }) // status clean
      .mockResolvedValueOnce({ ...fail }); // ls-remote fails (not timed out)

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes('unreachable'))).toBe(true);
  });

  it('returns passed:true with timed-out remote warning', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok }) // rev-parse
      .mockResolvedValueOnce({ ...ok, stdout: '' }) // status clean
      .mockResolvedValueOnce({ ...timedOut }); // ls-remote timed out

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes('timed out'))).toBe(true);
  });

  it('returns passed:true with no warnings when repo is clean and remote reachable', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...ok }) // rev-parse
      .mockResolvedValueOnce({ ...ok, stdout: '' }) // status clean
      .mockResolvedValueOnce({ ...ok }); // ls-remote ok

    const result = await gitValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
