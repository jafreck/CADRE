import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessResult } from '@cadre/command-diagnostics';

vi.mock('../../packages/command-diagnostics/dist/exec.js', () => ({
  execShell: vi.fn(),
  stripVSCodeEnv: vi.fn((env: Record<string, string>) => env),
  spawnProcess: vi.fn(),
  exec: vi.fn(),
  trackProcess: vi.fn(),
  killAllTrackedProcesses: vi.fn(),
  getTrackedProcessCount: vi.fn(() => 0),
}));

vi.mock('../../packages/command-diagnostics/dist/parse-failures.js', () => ({
  extractFailures: vi.fn(),
}));

const { execShell } = await import('../../packages/command-diagnostics/dist/exec.js');
const { extractFailures } = await import('../../packages/command-diagnostics/dist/parse-failures.js');
import { runWithRetry, type RunWithRetryConfig } from '../../src/util/command-verifier.js';

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

describe('runWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return immediately when command succeeds on first run (exit-code mode)', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const onFixNeeded = vi.fn();
    const result = await runWithRetry({
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
    const result = await runWithRetry({
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
    const result = await runWithRetry({
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
    const result = await runWithRetry({
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

  it('should not retry in regression mode when all failures are in the baseline', async () => {
    const baseline = new Set(['known-fail']);
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValueOnce(['known-fail']);

    const onFixNeeded = vi.fn();
    const result = await runWithRetry({
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
    const result = await runWithRetry({
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

  it('should not use sentinelValue when extractFailures returns results', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValueOnce(['real error']);

    const baseline = new Set(['real error']);
    const onFixNeeded = vi.fn();
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline,
      sentinelValue: 'UNKNOWN_FAILURE',
      onFixNeeded,
    });

    expect(result.failures).toEqual(['real error']);
    expect(result.failures).not.toContain('UNKNOWN_FAILURE');
  });

  it('should not use sentinelValue when exit code is 0', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const onFixNeeded = vi.fn();
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      sentinelValue: 'UNKNOWN_FAILURE',
      onFixNeeded,
    });

    expect(result.failures).toEqual([]);
  });

  it('should respect maxFixRounds and stop retrying', async () => {
    mockExecShell.mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValue(['persistent error']);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 2,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(['persistent error']);
    // 1 initial + 2 retries
    expect(mockExecShell).toHaveBeenCalledTimes(3);
  });

  it('should stop early in exit-code mode when command succeeds mid-loop', async () => {
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'fail' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'fail2' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'fixed' }));
    mockExtractFailures
      .mockReturnValueOnce(['err'])
      .mockReturnValueOnce(['err'])
      .mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 5,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(0);
    expect(mockExecShell).toHaveBeenCalledTimes(3);
  });

  it('should pass correct arguments to execShell', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0 }));
    mockExtractFailures.mockReturnValueOnce([]);

    await runWithRetry({
      command: 'npx vitest run',
      cwd: '/my/project',
      timeout: 30000,
      maxFixRounds: 1,
      onFixNeeded: vi.fn(),
    });

    expect(mockExecShell).toHaveBeenCalledWith('npx vitest run', { cwd: '/my/project', timeout: 30000 });
  });

  it('should combine stderr and stdout for output and pass to extractFailures', async () => {
    mockExecShell.mockResolvedValueOnce(
      makeProcessResult({ exitCode: 0, stderr: 'warning: ', stdout: 'all tests pass' }),
    );
    mockExtractFailures.mockReturnValueOnce([]);

    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 1,
      onFixNeeded: vi.fn(),
    });

    expect(result.output).toBe('warning: all tests pass');
    expect(mockExtractFailures).toHaveBeenCalledWith('warning: all tests pass');
  });

  it('should pass round index to onFixNeeded on each retry', async () => {
    mockExecShell.mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValue(['err']);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledWith(expect.any(String), 0);
    expect(onFixNeeded).toHaveBeenCalledWith(expect.any(String), 1);
    expect(onFixNeeded).toHaveBeenCalledWith(expect.any(String), 2);
  });

  it('should apply sentinelValue during retries as well', async () => {
    const baseline = new Set<string>();
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'crash' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'crash2' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 5,
      baseline,
      sentinelValue: 'SENTINEL',
      onFixNeeded,
    });

    // Sentinel should be treated as a regression (not in empty baseline)
    // so it retries until exit code 0
    expect(onFixNeeded).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(0);
    expect(result.regressions).toEqual([]);
  });

  it('should handle maxFixRounds of 0 (no retries)', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValueOnce(['error']);

    const onFixNeeded = vi.fn();
    const result = await runWithRetry({
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

  it('should compute regressions correctly with multiple new failures', async () => {
    const baseline = new Set(['old-fail-1', 'old-fail-2']);
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValueOnce(['old-fail-1', 'new-fail-1', 'old-fail-2', 'new-fail-2']);

    // Will retry once
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err2' }));
    mockExtractFailures.mockReturnValueOnce(['old-fail-1']);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(result.regressions).toEqual([]);
    expect(result.failures).toEqual(['old-fail-1']);
  });

  it('should propagate errors thrown by onFixNeeded', async () => {
    mockExecShell.mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: 'fail' }));
    mockExtractFailures.mockReturnValue(['err']);

    const onFixNeeded = vi.fn().mockRejectedValue(new Error('budget exceeded'));
    await expect(
      runWithRetry({
        command: 'npm test',
        cwd: '/tmp',
        timeout: 5000,
        maxFixRounds: 3,
        onFixNeeded,
      }),
    ).rejects.toThrow('budget exceeded');

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(mockExecShell).toHaveBeenCalledTimes(1);
  });

  it('should treat null exit code as non-zero in exit-code mode and retry', async () => {
    mockExecShell
      .mockResolvedValueOnce(makeProcessResult({ exitCode: null as unknown as number, stderr: 'killed' }))
      .mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
  });

  it('should treat all failures as regressions when baseline is an empty set', async () => {
    const baseline = new Set<string>();
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 1, stderr: 'err' }));
    mockExtractFailures.mockReturnValueOnce(['new-fail-1', 'new-fail-2']);

    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: 0, stdout: 'ok' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const onFixNeeded = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 3,
      baseline,
      onFixNeeded,
    });

    expect(onFixNeeded).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
    expect(result.regressions).toEqual([]);
  });

  it('should return null exitCode in result when process is killed', async () => {
    mockExecShell.mockResolvedValueOnce(makeProcessResult({ exitCode: null as unknown as number, stderr: 'killed' }));
    mockExtractFailures.mockReturnValueOnce([]);

    const result = await runWithRetry({
      command: 'npm test',
      cwd: '/tmp',
      timeout: 5000,
      maxFixRounds: 0,
      onFixNeeded: vi.fn(),
    });

    expect(result.exitCode).toBeNull();
  });
});
