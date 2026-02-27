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
import { verifyCommand, type VerifyCommandConfig } from '../../../packages/command-diagnostics/src/verify.js';

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

describe('verifyCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return immediately when command succeeds on first run (exit-code mode)', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const onFixNeeded = vi.fn();
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      onFixNeeded,
    });

    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.regressions).toEqual([]);
    expect(result.output).toBe('ok');
    expect(onFixNeeded).not.toHaveBeenCalled();
    expect(mockExecShell).toHaveBeenCalledTimes(1);
  });

  it('should return immediately when command succeeds on first run (regression mode)', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'all pass' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const onFixNeeded = vi.fn();
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline: new Set(['known-fail']),
      onFixNeeded,
    });

    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.regressions).toEqual([]);
    expect(onFixNeeded).not.toHaveBeenCalled();
  });

  it('should retry in exit-code mode when exit code is non-zero', async () => {
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'error output' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'fixed' }));
    mockExtractFailures
      .mockReturnValueOnce(['some error'])
      .mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(onFixNeeded).toHaveBeenCalledWith('error output', 0);
    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
    expect(mockExecShell).toHaveBeenCalledTimes(2);
  });

  it('should retry in regression mode when there are regressions', async () => {
    const baseline = new Set(['known-fail']);
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err2' }));
    mockExtractFailures
      .mockReturnValueOnce(['known-fail', 'new-fail'])
      .mockReturnValueOnce(['known-fail']);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(result.regressions).toEqual([]);
    expect(result.failures).toEqual(['known-fail']);
  });

  it('should not retry in regression mode when all failures are in baseline', async () => {
    const baseline = new Set(['known-fail']);
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValueOnce(['known-fail']);

    const onFixNeeded = vi.fn();
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline,
      onFixNeeded,
    });

    expect(onFixNeeded).not.toHaveBeenCalled();
    expect(result.regressions).toEqual([]);
    expect(result.failures).toEqual(['known-fail']);
  });

  it('should use sentinelValue when extractFailures returns empty on non-zero exit', async () => {
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'segfault' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      sentinelValue: 'UNKNOWN_FAILURE',
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('should respect maxFixRounds and stop retrying', async () => {
    mockExecShell.mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValue(['persistent error']);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 2,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(['persistent error']);
    expect(mockExecShell).toHaveBeenCalledTimes(3);
  });

  it('should handle maxFixRounds of 0 (no retries)', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValueOnce(['error']);

    const onFixNeeded = vi.fn();
    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 0,
      onFixNeeded,
    });

    expect(onFixNeeded).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(['error']);
    expect(mockExecShell).toHaveBeenCalledTimes(1);
  });

  it('should pass correct arguments to execShell', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));
    mockExtractFailures.mockReturnValueOnce([]);

    await verifyCommand({
      command: 'npx vitest run',
      cwd: '/my/project',
      timeout: 30000,
      maxFixRounds: 1,
      onFixNeeded: vi.fn(),
    });

    expect(mockExecShell).toHaveBeenCalledWith('npx vitest run', { cwd: '/my/project', timeout: 30000 });
  });

  it('should combine stderr and stdout for output', async () => {
    mockExecShell.mockResolvedValueOnce(
      makeProcessResult({ exitCode: 0, stderr: 'warning: ', stdout: 'all tests pass' }),
    );
    mockExtractFailures.mockReturnValueOnce([]);

    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 1,
      onFixNeeded: vi.fn(),
    });

    expect(result.output).toBe('warning: all tests pass');
    expect(mockExtractFailures).toHaveBeenCalledWith('warning: all tests pass');
  });

  it('should propagate errors thrown by onFixNeeded', async () => {
    mockExecShell.mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValue(['err']);

    const onFixNeeded = vi.fn().mockRejectedValue(new Error('budget exceeded'));
    await expect(
      verifyCommand({
        command: 'npm test',
        cwd: '/tmp',
        timeout: 5000,
        maxFixRounds: 3,
        onFixNeeded,
      }),
    ).rejects.toThrow('budget exceeded');
  });

  it('should return null exitCode when process is killed', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: null as unknown as number, stderr: 'killed' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const result = await verifyCommand({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 0,
      onFixNeeded: vi.fn(),
    });

    expect(result.exitCode).toBeNull();
  });
});
