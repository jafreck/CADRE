import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { commandValidator } from '../src/validation/command-validator.js';

const makeConfig = (
  overrides: Partial<{ build: string; test: string; install: string; lint: string }> = {},
): CadreConfig =>
  ({
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
    commands: {
      build: overrides.build ?? 'npm run build',
      test: overrides.test ?? 'npx vitest run',
      ...(overrides.install !== undefined ? { install: overrides.install } : {}),
      ...(overrides.lint !== undefined ? { lint: overrides.lint } : {}),
    },
  }) as unknown as CadreConfig;

const okResult = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const failResult = { exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false } as const;

describe('commandValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should expose the name "command"', () => {
    expect(commandValidator.name).toBe('command');
  });

  it('should return passed:true when all configured executables are found on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    const result = await commandValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should always return an empty warnings array', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    const result = await commandValidator.validate(makeConfig());

    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return passed:false when build executable is not found on PATH', async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...failResult }) // build fails
      .mockResolvedValue({ ...okResult });

    const result = await commandValidator.validate(makeConfig({ build: 'missing-build-tool' }));

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing-build-tool');
    expect(result.errors[0]).toContain('commands.build');
  });

  it('should return passed:false when test executable is not found on PATH', async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...okResult }) // build passes
      .mockResolvedValueOnce({ ...failResult }); // test fails

    const result = await commandValidator.validate(makeConfig({ test: 'missing-test-tool' }));

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing-test-tool');
    expect(result.errors[0]).toContain('commands.test');
  });

  it('should check install executable when install is configured', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig({ install: 'yarn install' }));

    expect(exec).toHaveBeenCalledWith('which', ['yarn']);
  });

  it('should check lint executable when lint is configured', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig({ lint: 'eslint src' }));

    expect(exec).toHaveBeenCalledWith('which', ['eslint']);
  });

  it('should skip install check when install is not configured', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig());

    const calls = vi.mocked(exec).mock.calls;
    expect(calls.every(([, args]) => args[0] !== 'install')).toBe(true);
    // Only build and test executables are checked
    expect(calls).toHaveLength(2);
  });

  it('should skip lint check when lint is not configured', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig());

    const calls = vi.mocked(exec).mock.calls;
    expect(calls.every(([, args]) => args[0] !== 'lint')).toBe(true);
  });

  it('should return passed:false with error for optional install when not found', async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...okResult }) // build
      .mockResolvedValueOnce({ ...okResult }) // test
      .mockResolvedValueOnce({ ...failResult }); // install

    const result = await commandValidator.validate(makeConfig({ install: 'pnpm install' }));

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('pnpm');
    expect(result.errors[0]).toContain('commands.install');
  });

  it('should return passed:false with error for optional lint when not found', async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...okResult }) // build
      .mockResolvedValueOnce({ ...okResult }) // test
      .mockResolvedValueOnce({ ...failResult }); // lint

    const result = await commandValidator.validate(makeConfig({ lint: 'missing-linter .' }));

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('missing-linter');
    expect(result.errors[0]).toContain('commands.lint');
  });

  it('should return multiple errors when multiple executables are missing', async () => {
    vi.mocked(exec).mockResolvedValue({ ...failResult });

    const result = await commandValidator.validate(makeConfig({ install: 'pnpm install', lint: 'eslint .' }));

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes('commands.build'))).toBe(true);
    expect(result.errors.some((e) => e.includes('commands.test'))).toBe(true);
  });

  it('should extract only the first token from a multi-word command as the executable', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig({ build: 'npm run build --watch' }));

    expect(exec).toHaveBeenCalledWith('which', ['npm']);
  });

  it('should call which with the executable name for each configured command', async () => {
    vi.mocked(exec).mockResolvedValue({ ...okResult });

    await commandValidator.validate(makeConfig({ build: 'tsc', test: 'jest' }));

    expect(exec).toHaveBeenCalledWith('which', ['tsc']);
    expect(exec).toHaveBeenCalledWith('which', ['jest']);
  });
});
