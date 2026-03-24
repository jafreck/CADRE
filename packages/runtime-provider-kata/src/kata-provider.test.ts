import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityMismatchError } from '@cadre-dev/framework/runtime';
import { KataProvider, StubKataAdapter, type KataAdapter } from './kata-provider.js';
import type { KataSessionConfig } from './types.js';

function makeMockAdapter(): KataAdapter {
  return {
    createSandbox: vi.fn().mockResolvedValue(undefined),
    execInSandbox: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'hello', stderr: '' }),
    stopSandbox: vi.fn().mockResolvedValue(undefined),
    destroySandbox: vi.fn().mockResolvedValue(undefined),
  };
}

describe('KataProvider', () => {
  let adapter: KataAdapter;
  let provider: KataProvider;

  beforeEach(() => {
    adapter = makeMockAdapter();
    provider = new KataProvider(adapter);
  });

  describe('name', () => {
    it('returns "kata"', () => {
      expect(provider.name).toBe('kata');
    });
  });

  describe('capabilities', () => {
    it('returns supported capabilities', () => {
      const caps = provider.capabilities();
      expect(caps.mounts).toBe(false);
      expect(caps.networkModes).toEqual(['none', 'full']);
      expect(caps.envAllowlist).toBe(false);
      expect(caps.secrets).toBe(false);
      expect(caps.resources).toBe(true);
    });
  });

  describe('createSession', () => {
    it('translates the policy and creates a sandbox, returning an IsolationSession', async () => {
      const session = await provider.createSession({ resources: { memoryMb: 256, cpuShares: 1 } });
      expect(typeof session.sessionId).toBe('string');
      expect(session.sessionId).toBeTruthy();
      expect(adapter.createSandbox).toHaveBeenCalledOnce();
      const [calledId, config] = (adapter.createSandbox as ReturnType<typeof vi.fn>).mock.calls[0] as [string, KataSessionConfig];
      expect(calledId).toBe(session.sessionId);
      expect(config.memoryLimitBytes).toBe(256 * 1024 * 1024);
      expect(config.cpuQuota).toBe(1);
    });

    it('throws CapabilityMismatchError for unsupported policy fields', async () => {
      await expect(
        provider.createSession({ secrets: [{ name: 'tok', value: 'x' }] }),
      ).rejects.toBeInstanceOf(CapabilityMismatchError);
      expect(adapter.createSandbox).not.toHaveBeenCalled();
    });
  });

  describe('session.exec', () => {
    it('runs a command and returns ExecResult', async () => {
      const session = await provider.createSession({});
      const result = await session.exec('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
      expect(result.stderr).toBe('');
      expect(adapter.execInSandbox).toHaveBeenCalledWith(session.sessionId, ['echo', 'hello']);
    });
  });

  describe('session.destroy', () => {
    it('destroys the sandbox via the adapter', async () => {
      const session = await provider.createSession({});
      await session.destroy();
      expect(adapter.destroySandbox).toHaveBeenCalledWith(session.sessionId);
    });
  });

  describe('full session lifecycle', () => {
    it('completes createSession -> exec -> destroy without errors', async () => {
      const session = await provider.createSession({ networkMode: 'none' });
      expect(session.sessionId).toBeTruthy();

      const result = await session.exec('whoami', []);
      expect(result.exitCode).toBe(0);

      await session.destroy();

      expect(adapter.createSandbox).toHaveBeenCalledOnce();
      expect(adapter.execInSandbox).toHaveBeenCalledOnce();
      expect(adapter.destroySandbox).toHaveBeenCalledOnce();
    });
  });

  describe('session.destroy hardening', () => {
    it('throws when exec is called after destroy', async () => {
      const session = await provider.createSession({});
      await session.destroy();
      await expect(session.exec('echo', ['hi'])).rejects.toThrow('has been destroyed');
    });

    it('is idempotent — second call does not invoke adapter again', async () => {
      const session = await provider.createSession({});
      await session.destroy();
      await session.destroy();
      expect(adapter.stopSandbox).toHaveBeenCalledTimes(1);
      expect(adapter.destroySandbox).toHaveBeenCalledTimes(1);
    });

    it('calls stopSandbox then destroySandbox', async () => {
      const order: string[] = [];
      (adapter.stopSandbox as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('stop'); });
      (adapter.destroySandbox as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('destroy'); });
      const session = await provider.createSession({});
      await session.destroy();
      expect(order).toEqual(['stop', 'destroy']);
    });

    it('calls destroySandbox even if stopSandbox throws', async () => {
      (adapter.stopSandbox as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stop failed'));
      const session = await provider.createSession({});
      await session.destroy();
      expect(adapter.destroySandbox).toHaveBeenCalledOnce();
    });

    it('does not throw when destroySandbox throws', async () => {
      (adapter.destroySandbox as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('destroy failed'));
      const session = await provider.createSession({});
      await expect(session.destroy()).resolves.toBeUndefined();
    });
  });

  describe('session.exec options forwarding', () => {
    it('forwards cwd via shell wrapper', async () => {
      const session = await provider.createSession({});
      await session.exec('pwd', [], { cwd: '/tmp' });
      expect(adapter.execInSandbox).toHaveBeenCalledWith(
        session.sessionId,
        ['sh', '-c', 'cd /tmp && exec "$@"', '--', 'pwd'],
      );
    });

    it('forwards env via env prefix', async () => {
      const session = await provider.createSession({});
      await session.exec('echo', ['$FOO'], { env: { FOO: 'bar' } });
      expect(adapter.execInSandbox).toHaveBeenCalledWith(
        session.sessionId,
        ['env', 'FOO=bar', 'echo', '$FOO'],
      );
    });

    it('forwards both cwd and env together', async () => {
      const session = await provider.createSession({});
      await session.exec('ls', [], { cwd: '/tmp', env: { X: '1' } });
      expect(adapter.execInSandbox).toHaveBeenCalledWith(
        session.sessionId,
        ['env', 'X=1', 'sh', '-c', 'cd /tmp && exec "$@"', '--', 'ls'],
      );
    });

    it('returns timedOut: true when command exceeds timeout', async () => {
      (adapter.execInSandbox as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, stdout: '', stderr: '' }), 500)),
      );
      const session = await provider.createSession({});
      const result = await session.exec('sleep', ['10'], { timeoutMs: 50 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('works normally when timeoutMs is not specified', async () => {
      const session = await provider.createSession({});
      const result = await session.exec('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when adapter.healthCheck returns healthy', async () => {
      (adapter as KataAdapter & { healthCheck: () => Promise<{ healthy: boolean; version?: string }> }).healthCheck =
        vi.fn().mockResolvedValue({ healthy: true, version: '1.0' });
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.details).toEqual({ version: '1.0' });
    });

    it('returns unhealthy when adapter.healthCheck returns unhealthy', async () => {
      (adapter as KataAdapter & { healthCheck: () => Promise<{ healthy: boolean; version?: string }> }).healthCheck =
        vi.fn().mockResolvedValue({ healthy: false });
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(false);
    });

    it('returns assumed-healthy when adapter has no healthCheck method', async () => {
      delete (adapter as unknown as Record<string, unknown>)['healthCheck'];
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.message).toContain('assumed healthy');
    });
  });
});
