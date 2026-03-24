import { describe, it, expect, vi } from 'vitest';
import { DockerSession } from '../docker-session.js';
import type { DockerRunner } from '../docker-session.js';
import type { ExecResult } from '@cadre-dev/framework/runtime';

function makeRunner(result: ExecResult = { exitCode: 0, stdout: 'ok', stderr: '' }): DockerRunner {
  return vi.fn(async (_args: string[]) => result);
}

function makeDelayedRunner(delayMs: number, result: ExecResult = { exitCode: 0, stdout: 'ok', stderr: '' }): DockerRunner {
  return vi.fn(async (_args: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return result;
  });
}

const CONTAINER_ID = 'test-container-abc';

describe('DockerSession', () => {
  it('sets sessionId to the container ID', () => {
    const session = new DockerSession({ containerId: CONTAINER_ID, runner: makeRunner() });
    expect(session.sessionId).toBe(CONTAINER_ID);
  });

  describe('exec()', () => {
    it('calls docker exec with container ID and command args', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.exec('echo', ['hello']);
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args[0]).toBe('exec');
      expect(args).toContain(CONTAINER_ID);
      expect(args).toContain('echo');
      expect(args).toContain('hello');
    });

    it('passes -w flag when cwd is specified in ExecOptions', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.exec('ls', [], { cwd: '/workspace' });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('-w');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('/workspace');
    });

    it('passes -e flags for each env var in ExecOptions', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.exec('env', [], { env: { MY_VAR: 'value', OTHER: 'val2' } });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).toContain('MY_VAR=value');
      expect(args).toContain('OTHER=val2');
    });

    it('returns the runner result as ExecResult', async () => {
      const runner = makeRunner({ exitCode: 0, stdout: 'hello world\n', stderr: '' });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      const result = await session.exec('echo', ['hello world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world\n');
    });

    it('throws when called after destroy()', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.destroy();
      await expect(session.exec('echo', [])).rejects.toThrow('destroyed');
    });
  });

  describe('destroy()', () => {
    it('calls docker stop with the container ID', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.destroy();
      // mock.calls[i][0] is the args array passed to the runner
      const calls = (runner as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const stopCall = calls.find((callArgs) => callArgs[0][0] === 'stop');
      expect(stopCall).toBeDefined();
      expect(stopCall![0]).toContain(CONTAINER_ID);
    });

    it('calls docker rm with the container ID', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.destroy();
      const calls = (runner as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const rmCall = calls.find((callArgs) => callArgs[0][0] === 'rm');
      expect(rmCall).toBeDefined();
      expect(rmCall![0]).toContain(CONTAINER_ID);
    });

    it('is idempotent — second destroy does not call runner again', async () => {
      const runner = makeRunner();
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await session.destroy();
      const callsAfterFirst = (runner as ReturnType<typeof vi.fn>).mock.calls.length;
      await session.destroy();
      expect((runner as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    });

    it('continues to docker rm even when docker stop throws', async () => {
      let callCount = 0;
      const runner = vi.fn(async (args: string[]) => {
        callCount++;
        if (args[0] === 'stop') throw new Error('stop failed');
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      // Should not throw
      await expect(session.destroy()).resolves.toBeUndefined();
      // rm should still be called despite stop throwing
      const calls = (runner as ReturnType<typeof vi.fn>).mock.calls as string[][][];
      const rmCall = calls.find((callArgs) => callArgs[0][0] === 'rm');
      expect(rmCall).toBeDefined();
    });

    it('does not throw when docker rm fails', async () => {
      const runner = vi.fn(async (args: string[]) => {
        if (args[0] === 'rm') throw new Error('rm failed');
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      await expect(session.destroy()).resolves.toBeUndefined();
    });
  });

  describe('exec() with timeoutMs', () => {
    it('returns result with timedOut: false when command completes within timeout', async () => {
      const runner = makeDelayedRunner(10, { exitCode: 0, stdout: 'done\n', stderr: '' });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      const result = await session.exec('echo', ['done'], { timeoutMs: 5000 });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('done\n');
      expect(result.timedOut).toBeUndefined();
    });

    it('returns timedOut: true with exitCode 124 when command exceeds timeout', async () => {
      const runner = makeDelayedRunner(5000, { exitCode: 0, stdout: 'done\n', stderr: '' });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      const result = await session.exec('sleep', ['10'], { timeoutMs: 50 });
      expect(result.exitCode).toBe(124);
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toBe('Command timed out');
    });

    it('works identically when timeoutMs is not specified (no regression)', async () => {
      const runner = makeRunner({ exitCode: 0, stdout: 'hello\n', stderr: '' });
      const session = new DockerSession({ containerId: CONTAINER_ID, runner });
      const result = await session.exec('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
      expect(result.timedOut).toBeUndefined();
    });
  });
});
