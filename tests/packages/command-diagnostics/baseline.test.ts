import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessResult } from '../../../packages/command-diagnostics/src/exec.js';

vi.mock('../../../packages/command-diagnostics/src/exec.js', () => ({
  execShell: vi.fn(),
}));

vi.mock('../../../packages/command-diagnostics/src/parse-failures.js', () => ({
  extractFailures: vi.fn(),
}));

import { execShell } from '../../../packages/command-diagnostics/src/exec.js';
import { extractFailures } from '../../../packages/command-diagnostics/src/parse-failures.js';
import { captureBaseline, baselineResultsSchema } from '../../../packages/command-diagnostics/src/baseline.js';

const mockExecShell = execShell as unknown as ReturnType<typeof vi.fn>;
const mockExtractFailures = extractFailures as unknown as ReturnType<typeof vi.fn>;

function makeProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    signal: null,
    timedOut: false,
    ...overrides,
  };
}

describe('captureBaseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractFailures.mockReturnValue([]);
  });

  it('should return zeros and empty arrays when no commands are provided', async () => {
    const result = await captureBaseline({ cwd: '/tmp' });
    expect(result).toEqual({
      buildExitCode: 0,
      testExitCode: 0,
      buildFailures: [],
      testFailures: [],
    });
    expect(mockExecShell).not.toHaveBeenCalled();
  });

  it('should run build command and record exit code 0 on success', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));
    const result = await captureBaseline({ cwd: '/tmp', buildCommand: 'npm run build' });

    expect(mockExecShell).toHaveBeenCalledWith('npm run build', { cwd: '/tmp', timeout: 300_000 });
    expect(result.buildExitCode).toBe(0);
    expect(result.buildFailures).toEqual([]);
  });

  it('should record non-zero buildExitCode and extract failures when build fails', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err', stdout: 'FAIL foo' }));
    mockExtractFailures.mockReturnValueOnce(['foo']);

    const result = await captureBaseline({ cwd: '/tmp', buildCommand: 'npm run build' });

    expect(result.buildExitCode).toBe(1);
    expect(result.buildFailures).toEqual(['foo']);
    expect(mockExtractFailures).toHaveBeenCalledWith('errFAIL foo');
  });

  it('should run test command and record exit code 0 on success', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));
    const result = await captureBaseline({ cwd: '/tmp', testCommand: 'npx vitest run' });

    expect(mockExecShell).toHaveBeenCalledWith('npx vitest run', { cwd: '/tmp', timeout: 300_000 });
    expect(result.testExitCode).toBe(0);
    expect(result.testFailures).toEqual([]);
  });

  it('should record non-zero testExitCode and extract failures when tests fail', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: '', stdout: '✗ should work' }));
    mockExtractFailures.mockReturnValueOnce(['should work']);

    const result = await captureBaseline({ cwd: '/tmp', testCommand: 'npm test' });

    expect(result.testExitCode).toBe(1);
    expect(result.testFailures).toEqual(['should work']);
  });

  it('should run both build and test commands when both are provided', async () => {
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));

    const result = await captureBaseline({
      cwd: '/tmp',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
    });

    expect(mockExecShell).toHaveBeenCalledTimes(2);
    expect(result.buildExitCode).toBe(0);
    expect(result.testExitCode).toBe(0);
  });

  it('should treat null exit code as 1', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: null as unknown as number }));

    const result = await captureBaseline({ cwd: '/tmp', buildCommand: 'npm run build' });

    expect(result.buildExitCode).toBe(1);
  });

  it('should use custom timeout when provided', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));

    await captureBaseline({ cwd: '/tmp', buildCommand: 'make', timeout: 60_000 });

    expect(mockExecShell).toHaveBeenCalledWith('make', { cwd: '/tmp', timeout: 60_000 });
  });

  it('should not extract failures when exit code is 0', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));

    const result = await captureBaseline({ cwd: '/tmp', buildCommand: 'npm run build' });

    expect(mockExtractFailures).not.toHaveBeenCalled();
    expect(result.buildFailures).toEqual([]);
  });
});

describe('baselineResultsSchema', () => {
  it('should validate a correct baseline result', () => {
    const result = baselineResultsSchema.safeParse({
      buildExitCode: 0,
      testExitCode: 0,
      buildFailures: [],
      testFailures: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing fields', () => {
    const result = baselineResultsSchema.safeParse({ buildExitCode: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric exit codes', () => {
    const result = baselineResultsSchema.safeParse({
      buildExitCode: 'zero',
      testExitCode: 0,
      buildFailures: [],
      testFailures: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-array failures', () => {
    const result = baselineResultsSchema.safeParse({
      buildExitCode: 0,
      testExitCode: 0,
      buildFailures: 'not-array',
      testFailures: [],
    });
    expect(result.success).toBe(false);
  });
});
