import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';
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

const baseConfig: CadreConfig = CadreConfigSchema.parse({
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

  it('should have name "git-validator"', () => {
    expect(validator.name).toBe('git-validator');
  });

  it('should fail when .git directory does not exist', async () => {
    mockExists.mockResolvedValue(false);

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('.git');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should fail when baseBranch does not exist locally', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: no such ref', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('main');
  });

  it('should pass with no warnings when working tree is clean and remote is reachable', async () => {
    mockExists.mockResolvedValue(true);
    // rev-parse --verify: success
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    // git status --porcelain: clean (empty output)
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    // git ls-remote: success
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should warn when working tree is dirty', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: ' M src/foo.ts\n', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('uncommitted');
  });

  it('should warn when remote is unreachable (non-zero exit)', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'unable to connect', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('origin');
  });

  it('should warn when remote check times out', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: null, stdout: '', stderr: '', signal: 'SIGTERM', timedOut: true });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('origin');
  });

  it('should warn for both dirty tree and unreachable remote', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '?? newfile.ts\n', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  it('should include name in returned result', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(baseConfig);

    expect(result.name).toBe('git-validator');
  });

  it('should use config.repoPath for git commands', async () => {
    mockExists.mockResolvedValue(true);
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc123\tHEAD', stderr: '', signal: null, timedOut: false });

    await validator.validate(baseConfig);

    const calls = mockExec.mock.calls;
    expect(calls[0][2]?.cwd).toBe(baseConfig.repoPath);
    expect(calls[1][2]?.cwd).toBe(baseConfig.repoPath);
    expect(calls[2][2]?.cwd).toBe(baseConfig.repoPath);
  });
});
