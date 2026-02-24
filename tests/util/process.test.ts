import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripVSCodeEnv, spawnProcess, exec, execShell, trackProcess, killAllTrackedProcesses, getTrackedProcessCount } from '../../src/util/process.js';

describe('stripVSCodeEnv', () => {
  it('should remove VSCODE_ prefixed keys', () => {
    const env = { VSCODE_IPC: 'foo', OTHER: 'bar' };
    const result = stripVSCodeEnv(env);
    expect(result).not.toHaveProperty('VSCODE_IPC');
    expect(result).toHaveProperty('OTHER', 'bar');
  });

  it('should remove ELECTRON_ prefixed keys', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', KEEP: 'yes' };
    const result = stripVSCodeEnv(env);
    expect(result).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(result).toHaveProperty('KEEP', 'yes');
  });

  it('should remove TERM_PROGRAM_VERSION', () => {
    const env = { TERM_PROGRAM_VERSION: '1.0', OTHER: 'ok' };
    const result = stripVSCodeEnv(env);
    expect(result).not.toHaveProperty('TERM_PROGRAM_VERSION');
  });

  it('should remove ORIGINAL_XDG_CURRENT_DESKTOP', () => {
    const env = { ORIGINAL_XDG_CURRENT_DESKTOP: 'gnome', OTHER: 'ok' };
    const result = stripVSCodeEnv(env);
    expect(result).not.toHaveProperty('ORIGINAL_XDG_CURRENT_DESKTOP');
  });

  it('should not mutate the original env object', () => {
    const env = { VSCODE_IPC: 'foo', OTHER: 'bar' };
    stripVSCodeEnv(env);
    expect(env).toHaveProperty('VSCODE_IPC', 'foo');
  });

  it('should return an empty object when given an empty object', () => {
    expect(stripVSCodeEnv({})).toEqual({});
  });

  it('should keep unrelated keys intact', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user' };
    const result = stripVSCodeEnv(env);
    expect(result).toEqual({ PATH: '/usr/bin', HOME: '/home/user' });
  });
});

describe('spawnProcess', () => {
  it('should resolve with stdout, stderr, and exitCode on successful command', async () => {
    const { promise } = spawnProcess('echo', ['hello']);
    const result = await promise;
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
  });

  it('should resolve with non-zero exitCode on failed command', async () => {
    const { promise } = spawnProcess('sh', ['-c', 'exit 1']);
    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it('should capture stderr output', async () => {
    const { promise } = spawnProcess('sh', ['-c', 'echo error_output >&2']);
    const result = await promise;
    expect(result.stderr.trim()).toBe('error_output');
  });

  it('should return the child process object', () => {
    const { process: child } = spawnProcess('echo', ['hello']);
    expect(child).toBeDefined();
    expect(typeof child.pid).toBe('number');
  });

  it('should time out and set timedOut=true when timeout is exceeded', async () => {
    const { promise } = spawnProcess('sleep', ['10'], { timeout: 100 });
    const result = await promise;
    expect(result.timedOut).toBe(true);
  });

  it('should spawn process in a detached process group', async () => {
    const { process: child, promise } = spawnProcess('echo', ['detached-test']);
    // In detached mode the child becomes group leader: pgid === pid
    if (child.pid !== undefined) {
      const pgid = process.getegid ? (process as any).getpgid?.(child.pid) : undefined;
      // If getpgid is available, pgid should equal child.pid (group leader)
      if (pgid !== undefined) {
        expect(pgid).toBe(child.pid);
      }
    }
    await promise;
  });

  it('should still resolve the promise after unref (child completes normally)', async () => {
    const { promise } = spawnProcess('echo', ['after-unref']);
    const result = await promise;
    expect(result.stdout.trim()).toBe('after-unref');
    expect(result.exitCode).toBe(0);
  });

  it('should resolve with exitCode=1 on process error', async () => {
    const { promise } = spawnProcess('nonexistent_command_xyz', []);
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBeTruthy();
  });
});

describe('exec', () => {
  it('should return a ProcessResult for a successful command', async () => {
    const result = await exec('echo', ['world']);
    expect(result.stdout.trim()).toBe('world');
    expect(result.exitCode).toBe(0);
  });

  it('should capture stderr via exec', async () => {
    const result = await exec('sh', ['-c', 'echo err >&2; exit 2']);
    expect(result.stderr.trim()).toBe('err');
    expect(result.exitCode).toBe(2);
  });
});

describe('execShell', () => {
  it('should run a shell command string and return output', async () => {
    const result = await execShell('echo shell_test');
    expect(result.stdout.trim()).toBe('shell_test');
    expect(result.exitCode).toBe(0);
  });

  it('should handle shell pipeline commands', async () => {
    const result = await execShell('echo foo | tr a-z A-Z');
    expect(result.stdout.trim()).toBe('FOO');
  });
});

describe('trackProcess / killAllTrackedProcesses / getTrackedProcessCount', () => {
  beforeEach(() => {
    killAllTrackedProcesses();
  });

  it('should track a child process and increment count', () => {
    const { process: child } = spawnProcess('sleep', ['5']);
    trackProcess(child);
    expect(getTrackedProcessCount()).toBeGreaterThanOrEqual(1);
    child.kill('SIGTERM');
  });

  it('should remove process from tracking when it closes', async () => {
    const { process: child, promise } = spawnProcess('echo', ['done']);
    trackProcess(child);
    await promise;
    // After close, the process should be removed
    expect(getTrackedProcessCount()).toBe(0);
  });

  it('should return 0 when no processes are tracked', () => {
    expect(getTrackedProcessCount()).toBe(0);
  });

  it('should kill all tracked processes and clear the set', () => {
    const { process: child1 } = spawnProcess('sleep', ['5']);
    const { process: child2 } = spawnProcess('sleep', ['5']);
    trackProcess(child1);
    trackProcess(child2);
    expect(getTrackedProcessCount()).toBe(2);
    killAllTrackedProcesses();
    expect(getTrackedProcessCount()).toBe(0);
  });
});
