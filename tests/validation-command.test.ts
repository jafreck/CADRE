import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { CommandValidator } from '../src/validation/command-validator.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

const mockExec = vi.mocked(exec);

describe('CommandValidator', () => {
  let validator: CommandValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new CommandValidator();
  });

  it('should pass when no commands are configured', async () => {
    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should pass when all configured command executables are on PATH', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { install: 'npm install', build: 'npm run build' },
    });

    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/npm', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when a configured command executable is not on PATH', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { build: 'missing-tool build' },
    });

    mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(config);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
