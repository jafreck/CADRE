import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need real child_process types but will mock the spawn function
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => {
  const spawn = vi.fn();
  return { spawn };
});

import { spawn } from 'node:child_process';
const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

/**
 * Creates a minimal mock ChildProcess that extends EventEmitter so
 * event listeners (.on) and .emit work as expected.
 */
function makeMockChild(pid = 12345): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as unknown as Record<string, unknown>).pid = pid;
  (child as unknown as Record<string, unknown>).killed = false;
  (child as unknown as Record<string, unknown>).kill = vi.fn();
  (child as unknown as Record<string, unknown>).unref = vi.fn();
  (child as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (child as unknown as Record<string, unknown>).stderr = new EventEmitter();
  return child;
}

// Import after mocks are set up
import { spawnProcess, trackProcess, killAllTrackedProcesses, getTrackedProcessCount } from '../src/util/process.js';

describe('spawnProcess — timeout kills process group with SIGTERM then SIGKILL', () => {
  let processKillSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    processKillSpy.mockRestore();
  });

  it('calls process.kill with negative PID and SIGTERM on timeout', async () => {
    const child = makeMockChild(1000);
    mockSpawn.mockReturnValue(child);

    const { promise } = spawnProcess('echo', ['hello'], { timeout: 100 });

    // Advance time past the timeout
    vi.advanceTimersByTime(200);

    expect(processKillSpy).toHaveBeenCalledWith(-1000, 'SIGTERM');

    // Resolve the promise by emitting close
    (child as unknown as EventEmitter).emit('close', null, 'SIGTERM');
    await promise;
  });

  it('calls process.kill with negative PID and SIGKILL after grace period', async () => {
    const child = makeMockChild(2000);
    // child.killed stays false so the SIGKILL branch fires
    mockSpawn.mockReturnValue(child);

    const { promise } = spawnProcess('echo', ['hello'], { timeout: 100 });

    // Fire the initial timeout (SIGTERM)
    vi.advanceTimersByTime(200);
    expect(processKillSpy).toHaveBeenCalledWith(-2000, 'SIGTERM');

    // Advance the grace period (5 s) so the force-kill timer fires
    vi.advanceTimersByTime(5100);
    expect(processKillSpy).toHaveBeenCalledWith(-2000, 'SIGKILL');

    (child as unknown as EventEmitter).emit('close', null, 'SIGKILL');
    await promise;
  });

  it('falls back to child.kill() when process.kill throws on SIGTERM', async () => {
    const child = makeMockChild(3000);
    mockSpawn.mockReturnValue(child);
    // Make process.kill throw so the catch block runs child.kill()
    processKillSpy.mockImplementation(() => { throw new Error('ESRCH'); });

    const { promise } = spawnProcess('echo', ['hello'], { timeout: 100 });

    vi.advanceTimersByTime(200);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    (child as unknown as EventEmitter).emit('close', null, 'SIGTERM');
    await promise;
  });

  it('resolves with timedOut=true when timeout fires', async () => {
    const child = makeMockChild(4000);
    mockSpawn.mockReturnValue(child);

    const { promise } = spawnProcess('sleep', ['999'], { timeout: 100 });

    vi.advanceTimersByTime(200);

    (child as unknown as EventEmitter).emit('close', null, 'SIGTERM');
    const result = await promise;

    expect(result.timedOut).toBe(true);
  });

  it('resolves normally (timedOut=false) when process exits before timeout', async () => {
    const child = makeMockChild(5000);
    mockSpawn.mockReturnValue(child);

    const { promise } = spawnProcess('echo', ['hi'], { timeout: 5000 });

    (child as unknown as EventEmitter).emit('close', 0, null);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('resolves with exit code 1 and error message on child error event', async () => {
    const child = makeMockChild(6000);
    mockSpawn.mockReturnValue(child);

    const { promise } = spawnProcess('bad-cmd', [], {});

    (child as unknown as EventEmitter).emit('error', new Error('ENOENT'));
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ENOENT');
  });
});

describe('killAllTrackedProcesses — kills tracked process groups', () => {
  let processKillSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    processKillSpy.mockRestore();
  });

  it('calls process.kill with negative PID and SIGTERM for each tracked process', () => {
    const child = makeMockChild(9001);
    trackProcess(child);

    expect(getTrackedProcessCount()).toBe(1);

    killAllTrackedProcesses();

    expect(processKillSpy).toHaveBeenCalledWith(-9001, 'SIGTERM');
    expect(getTrackedProcessCount()).toBe(0);
  });

  it('falls back to child.kill() when process.kill throws during killAllTrackedProcesses', () => {
    const child = makeMockChild(9002);
    trackProcess(child);

    processKillSpy.mockImplementation(() => { throw new Error('ESRCH'); });

    killAllTrackedProcesses();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(getTrackedProcessCount()).toBe(0);
  });

  it('clears the tracked set after killing', () => {
    const child1 = makeMockChild(9003);
    const child2 = makeMockChild(9004);
    trackProcess(child1);
    trackProcess(child2);

    expect(getTrackedProcessCount()).toBe(2);

    killAllTrackedProcesses();

    expect(getTrackedProcessCount()).toBe(0);
  });
});
