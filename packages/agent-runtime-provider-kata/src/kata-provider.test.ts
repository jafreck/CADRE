import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityMismatchError } from '@cadre/agent-runtime';
import { KataProvider, type KataAdapter } from './kata-provider.js';
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
});
