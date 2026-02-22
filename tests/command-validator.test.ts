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

  it('should have name "commands"', () => {
    expect(validator.name).toBe('commands');
  });

  it('should pass when no commands are configured', async () => {
    const result = await validator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should pass when all configured command executables are on PATH', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { install: 'npm install', build: 'npm run build', test: 'npx vitest run' },
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
    expect(result.errors[0]).toContain('missing-tool');
    expect(result.errors[0]).toContain('build');
  });

  it('should skip commands that are not configured', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { test: 'jest' },
    });

    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/jest', stderr: '', signal: null, timedOut: false });

    await validator.validate(config);

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith('which', ['jest']);
  });

  it('should check each configured command separately', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { install: 'npm install', build: 'make build', test: 'jest', lint: 'eslint .' },
    });

    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/tool', stderr: '', signal: null, timedOut: false });

    await validator.validate(config);

    expect(mockExec).toHaveBeenCalledTimes(4);
    expect(mockExec).toHaveBeenCalledWith('which', ['npm']);
    expect(mockExec).toHaveBeenCalledWith('which', ['make']);
    expect(mockExec).toHaveBeenCalledWith('which', ['jest']);
    expect(mockExec).toHaveBeenCalledWith('which', ['eslint']);
  });

  it('should report multiple errors when multiple executables are missing', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { build: 'missing-build arg', test: 'missing-test arg' },
    });

    mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(config);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('should extract only the first word of a command as the executable', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { install: 'npm ci --prefer-offline' },
    });

    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/npm', stderr: '', signal: null, timedOut: false });

    await validator.validate(config);

    expect(mockExec).toHaveBeenCalledWith('which', ['npm']);
  });

  it('should handle commands with extra leading whitespace', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { lint: '  eslint src/' },
    });

    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/eslint', stderr: '', signal: null, timedOut: false });

    await validator.validate(config);

    expect(mockExec).toHaveBeenCalledWith('which', ['eslint']);
  });

  it('should include the label name in error messages', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { lint: 'nonexistent-linter .' },
    });

    mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(config);

    expect(result.errors[0]).toContain('lint');
    expect(result.errors[0]).toContain('nonexistent-linter');
  });

  it('should include name in returned result', async () => {
    const result = await validator.validate(baseConfig);

    expect(result.name).toBe('commands');
  });

  it('should pass with no errors when one command passes and others are undefined', async () => {
    const config = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      commands: { install: 'yarn install' },
    });

    mockExec.mockResolvedValueOnce({ exitCode: 0, stdout: '/usr/bin/yarn', stderr: '', signal: null, timedOut: false });

    const result = await validator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
