import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerProvider } from '../docker-provider.js';
import type { DockerRunner } from '../docker-session.js';
import type { ExecResult, IsolationPolicy } from '@cadre/agent-runtime';

function makeRunner(results: ExecResult[]): DockerRunner {
  let callIndex = 0;
  return vi.fn(async (_args: string[]) => {
    return results[callIndex++] ?? { exitCode: 0, stdout: '', stderr: '' };
  });
}

const SUCCESS_CONTAINER_ID = 'abc123def456';

function makeSuccessRunner(containerId = SUCCESS_CONTAINER_ID): DockerRunner {
  return makeRunner([{ exitCode: 0, stdout: `${containerId}\n`, stderr: '' }]);
}

describe('DockerProvider', () => {
  it('has name "docker"', () => {
    const provider = new DockerProvider({ image: 'ubuntu:22.04' });
    expect(provider.name).toBe('docker');
  });

  describe('capabilities()', () => {
    it('reports mounts as supported', () => {
      const provider = new DockerProvider({ image: 'ubuntu:22.04' });
      expect(provider.capabilities().mounts).toBe(true);
    });

    it('reports all network modes as supported', () => {
      const provider = new DockerProvider({ image: 'ubuntu:22.04' });
      expect(provider.capabilities().networkModes).toEqual(
        expect.arrayContaining(['none', 'allowlist', 'full'])
      );
    });

    it('reports envAllowlist as supported', () => {
      const provider = new DockerProvider({ image: 'ubuntu:22.04' });
      expect(provider.capabilities().envAllowlist).toBe(true);
    });

    it('reports resources as supported', () => {
      const provider = new DockerProvider({ image: 'ubuntu:22.04' });
      expect(provider.capabilities().resources).toBe(true);
    });
  });

  describe('createSession() — docker run flags', () => {
    it('starts container with -d and --init flags', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({});
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).toContain('-d');
      expect(args).toContain('--init');
    });

    it('appends image and sleep infinity', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'my-image:latest', runner });
      await provider.createSession({});
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).toContain('my-image:latest');
      expect(args.slice(-2)).toEqual(['sleep', 'infinity']);
    });

    it('applies --network none for networkMode "none"', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ networkMode: 'none' });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const networkIdx = args.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(-1);
      expect(args[networkIdx + 1]).toBe('none');
    });

    it('applies --network bridge for networkMode "allowlist"', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ networkMode: 'allowlist' });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const networkIdx = args.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(-1);
      expect(args[networkIdx + 1]).toBe('bridge');
    });

    it('applies --network bridge for networkMode "full"', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ networkMode: 'full' });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const networkIdx = args.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(-1);
      expect(args[networkIdx + 1]).toBe('bridge');
    });

    it('omits --network flag when networkMode is not specified', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({});
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).not.toContain('--network');
    });

    it('applies --memory flag from resources.memoryMb', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ resources: { memoryMb: 512 } });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('--memory');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('512m');
    });

    it('applies --cpu-shares flag from resources.cpuShares', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ resources: { cpuShares: 1024 } });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('--cpu-shares');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('1024');
    });

    it('applies --pids-limit flag from resources.pidsLimit', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ resources: { pidsLimit: 100 } });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('--pids-limit');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('100');
    });

    it('applies --ulimit flags from resources.ulimits', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({
        resources: { ulimits: [{ type: 'nofile', soft: 1024, hard: 2048 }] },
      });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('--ulimit');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('nofile=1024:2048');
    });

    it('applies --stop-timeout flag from resources.timeoutMs (rounded up to seconds)', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({ resources: { timeoutMs: 30000 } });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      const idx = args.indexOf('--stop-timeout');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('30');
    });

    it('mounts policy paths with correct mode', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      await provider.createSession({
        mounts: [
          { path: '/data', readOnly: true },
          { path: '/output', readOnly: false },
        ],
      });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).toContain('/data:/data:ro');
      expect(args).toContain('/output:/output:rw');
    });

    it('mounts worktreePath at /workspace', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({
        image: 'ubuntu:22.04',
        worktreePath: '/home/user/project',
        runner,
      });
      await provider.createSession({});
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args).toContain('/home/user/project:/workspace:rw');
    });

    it('only passes env vars in envAllowlist', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({
        image: 'ubuntu:22.04',
        runner,
        hostEnv: { HOME: '/root', SECRET: 'hidden', PATH: '/usr/bin' },
      });
      await provider.createSession({ envAllowlist: ['HOME', 'PATH'] });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      // HOME and PATH should be forwarded
      expect(args).toContain('HOME=/root');
      expect(args).toContain('PATH=/usr/bin');
      // SECRET must not be forwarded
      expect(args.join(' ')).not.toContain('SECRET');
    });

    it('skips env vars not present in host environment', async () => {
      const runner = makeSuccessRunner();
      const provider = new DockerProvider({
        image: 'ubuntu:22.04',
        runner,
        hostEnv: { HOME: '/root' },
      });
      await provider.createSession({ envAllowlist: ['HOME', 'MISSING_VAR'] });
      const args = (runner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
      expect(args.join(' ')).not.toContain('MISSING_VAR');
    });

    it('throws when docker run fails', async () => {
      const runner = vi.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'docker: image not found',
      }));
      const provider = new DockerProvider({ image: 'bad-image', runner });
      await expect(provider.createSession({})).rejects.toThrow(
        'Failed to start Docker container'
      );
    });

    it('returns a session with sessionId equal to the container ID', async () => {
      const runner = makeSuccessRunner('container-xyz');
      const provider = new DockerProvider({ image: 'ubuntu:22.04', runner });
      const session = await provider.createSession({});
      expect(session.sessionId).toBe('container-xyz');
    });
  });
});
