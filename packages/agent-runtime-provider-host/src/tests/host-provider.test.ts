import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { ProcessResult } from '@cadre/command-diagnostics';
import * as commandDiagnostics from '@cadre/command-diagnostics';
import { HostProvider } from '../host-provider.js';

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

describe('HostProvider', () => {
  it('is named "host"', () => {
    const provider = new HostProvider();
    expect(provider.name).toBe('host');
  });

  describe('capabilities()', () => {
    it('returns expected capability flags', () => {
      const provider = new HostProvider();
      const caps = provider.capabilities();
      expect(caps.mounts).toBe(false);
      expect(caps.networkModes).toEqual(['full']);
      expect(caps.envAllowlist).toBe(false);
      expect(caps.secrets).toBe(false);
      expect(caps.resources).toBe(false);
    });
  });

  describe('createSession()', () => {
    it('creates a session with a unique sessionId', async () => {
      const provider = new HostProvider();
      const session = await provider.createSession({});
      expect(typeof session.sessionId).toBe('string');
      expect(session.sessionId.length).toBeGreaterThan(0);
    });

    it('creates distinct session IDs for each call', async () => {
      const provider = new HostProvider();
      const s1 = await provider.createSession({});
      const s2 = await provider.createSession({});
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });
  });
});

describe('HostSession.exec()', () => {
  let spawnProcessSpy: MockInstance;

  beforeEach(() => {
    spawnProcessSpy = vi.spyOn(commandDiagnostics, 'spawnProcess');
  });

  it('delegates to spawnProcess with correct command and args', async () => {
    const result = makeProcessResult({ exitCode: 0, stdout: 'hello', stderr: '' });
    spawnProcessSpy.mockReturnValue({ promise: Promise.resolve(result), process: {} as ChildProcess });

    const provider = new HostProvider();
    const session = await provider.createSession({});
    await session.exec('echo', ['hello'], {});

    expect(spawnProcessSpy).toHaveBeenCalledWith('echo', ['hello'], expect.any(Object));
  });

  it('passes env, cwd, and timeout to spawnProcess', async () => {
    const result = makeProcessResult();
    spawnProcessSpy.mockReturnValue({ promise: Promise.resolve(result), process: {} as ChildProcess });

    const provider = new HostProvider();
    const session = await provider.createSession({});
    const env = { MY_VAR: 'value' };
    const cwd = '/tmp/test';
    const timeoutMs = 5000;

    await session.exec('cmd', ['arg'], { env, cwd, timeoutMs });

    expect(spawnProcessSpy).toHaveBeenCalledWith('cmd', ['arg'], {
      env,
      cwd,
      timeout: timeoutMs,
    });
  });

  it('returns the exit code, stdout, and stderr from spawnProcess', async () => {
    const result = makeProcessResult({ exitCode: 42, stdout: 'out', stderr: 'err' });
    spawnProcessSpy.mockReturnValue({ promise: Promise.resolve(result), process: {} as ChildProcess });

    const provider = new HostProvider();
    const session = await provider.createSession({});
    const execResult = await session.exec('cmd', []);

    expect(execResult.exitCode).toBe(42);
    expect(execResult.stdout).toBe('out');
    expect(execResult.stderr).toBe('err');
  });

  it('maps null exitCode to 1', async () => {
    const result = makeProcessResult({ exitCode: null });
    spawnProcessSpy.mockReturnValue({ promise: Promise.resolve(result), process: {} as ChildProcess });

    const provider = new HostProvider();
    const session = await provider.createSession({});
    const execResult = await session.exec('cmd', []);

    expect(execResult.exitCode).toBe(1);
  });
});

describe('HostSession.destroy()', () => {
  it('is a no-op and resolves without error', async () => {
    const provider = new HostProvider();
    const session = await provider.createSession({});
    await expect(session.destroy()).resolves.toBeUndefined();
  });
});
