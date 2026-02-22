import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { GitValidator } from '../src/validation/git-validator.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  issues: { ids: [1] },
});

const mockExec = vi.mocked(exec);
const mockExists = vi.mocked(exists);

describe('GitValidator', () => {
  let validator: GitValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new GitValidator();
  });

  it('should pass when .git exists, branch exists, tree is clean, and remote is reachable', async () => {
    mockExists.mockResolvedValue(true);
    mockExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should fail when .git directory does not exist', async () => {
    mockExists.mockResolvedValue(false);

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should fail when baseBranch does not exist locally', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: no such ref', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should warn (but pass) when working tree is dirty', async () => {
    mockExists.mockResolvedValue(true);
    mockExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M src/foo.ts\n', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should warn (but pass) when remote is unreachable', async () => {
    mockExists.mockResolvedValue(true);
    mockExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'unable to connect', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});
