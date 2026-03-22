import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NerdctlKataAdapter } from '../nerdctl-adapter.js';
import type { KataSessionConfig } from '../types.js';

type Runner = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function makeRunner(): Runner & ReturnType<typeof vi.fn> {
  return vi.fn<Runner>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
}

describe('NerdctlKataAdapter', () => {
  let runner: Runner & ReturnType<typeof vi.fn>;
  let adapter: NerdctlKataAdapter;

  beforeEach(() => {
    runner = makeRunner();
    adapter = new NerdctlKataAdapter({ image: 'alpine:3', runner });
  });

  describe('createSandbox', () => {
    it('calls runner with correct args for a full config', async () => {
      const config: KataSessionConfig = {
        runtime: 'io.containerd.kata.v2',
        networkIsolation: true,
        memoryLimitBytes: 268435456,
        cpuQuota: 512,
        readOnlyRootfs: true,
      };
      await adapter.createSandbox('sess-1', config);
      expect(runner).toHaveBeenCalledWith([
        'run', '-d',
        '--runtime', 'io.containerd.kata.v2',
        '--name', 'sess-1',
        '--network', 'none',
        '--memory', '268435456',
        '--cpu-shares', '512',
        '--read-only',
        'alpine:3', 'sleep', 'infinity',
      ]);
    });

    it('omits --network/--memory/--cpu-shares/--read-only when config fields are unset', async () => {
      const config: KataSessionConfig = {
        runtime: 'io.containerd.kata.v2',
        networkIsolation: false,
        readOnlyRootfs: false,
      };
      await adapter.createSandbox('sess-2', config);
      expect(runner).toHaveBeenCalledWith([
        'run', '-d',
        '--runtime', 'io.containerd.kata.v2',
        '--name', 'sess-2',
        'alpine:3', 'sleep', 'infinity',
      ]);
    });

    it('throws when runner returns non-zero exit code', async () => {
      runner.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'daemon error' });
      await expect(
        adapter.createSandbox('sess-3', {
          runtime: 'io.containerd.kata.v2',
          networkIsolation: false,
          readOnlyRootfs: false,
        }),
      ).rejects.toThrow('Failed to create Kata sandbox: daemon error');
    });
  });

  describe('execInSandbox', () => {
    it('calls runner with ["exec", sessionId, ...command]', async () => {
      runner.mockResolvedValue({ exitCode: 0, stdout: 'hi', stderr: '' });
      const result = await adapter.execInSandbox('sess-1', ['echo', 'hi']);
      expect(runner).toHaveBeenCalledWith(['exec', 'sess-1', 'echo', 'hi']);
      expect(result).toEqual({ exitCode: 0, stdout: 'hi', stderr: '' });
    });
  });

  describe('stopSandbox', () => {
    it('calls runner with ["stop", sessionId]', async () => {
      await adapter.stopSandbox('sess-1');
      expect(runner).toHaveBeenCalledWith(['stop', 'sess-1']);
    });

    it('does not throw when runner fails', async () => {
      runner.mockRejectedValue(new Error('stop failed'));
      await expect(adapter.stopSandbox('sess-1')).resolves.toBeUndefined();
    });
  });

  describe('destroySandbox', () => {
    it('calls runner with ["rm", "--force", sessionId]', async () => {
      await adapter.destroySandbox('sess-1');
      expect(runner).toHaveBeenCalledWith(['rm', '--force', 'sess-1']);
    });

    it('does not throw when runner fails', async () => {
      runner.mockRejectedValue(new Error('rm failed'));
      await expect(adapter.destroySandbox('sess-1')).resolves.toBeUndefined();
    });
  });
});
