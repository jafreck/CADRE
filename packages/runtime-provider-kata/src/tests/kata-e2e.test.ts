import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { KataProvider } from '../kata-provider.js';
import { NerdctlKataAdapter } from '../nerdctl-adapter.js';

const SKIP = process.env.CADRE_E2E_KATA !== '1';
const IMAGE = 'alpine:3';

function nerdctl(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('nerdctl', args, (error, stdout, stderr) => {
      const exitCode = error != null ? 1 : 0;
      resolve({ exitCode, stdout, stderr });
    });
  });
}

(SKIP ? describe.skip : describe)('KataProvider E2E (requires Kata runtime)', () => {
  const createdSessionIds: string[] = [];

  function createProvider(): KataProvider {
    const adapter = new NerdctlKataAdapter({ image: IMAGE });
    return new KataProvider(adapter);
  }

  afterAll(async () => {
    // Force-remove any remaining containers
    for (const id of createdSessionIds) {
      try {
        await nerdctl(['rm', '--force', id]);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('healthCheck() returns healthy against real Kata/containerd', async () => {
    const provider = createProvider();
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('full lifecycle: create → exec → destroy', async () => {
    const provider = createProvider();
    const session = await provider.createSession({});
    createdSessionIds.push(session.sessionId);

    const result = await session.exec('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');

    await session.destroy();

    // Verify the container is gone
    const check = await nerdctl(['ps', '-a', '--filter', `name=${session.sessionId}`, '--format', '{{.ID}}']);
    expect(check.stdout.trim()).toBe('');
  });

  it('network isolation mode none', async () => {
    const provider = createProvider();
    const session = await provider.createSession({ networkMode: 'none' });
    createdSessionIds.push(session.sessionId);

    const result = await session.exec('ping', ['-c', '1', '-W', '2', '8.8.8.8']);
    expect(result.exitCode).not.toBe(0);

    await session.destroy();
  });

  it('resource limits (memory)', async () => {
    const provider = createProvider();
    const session = await provider.createSession({ resources: { memoryMb: 64 } });
    createdSessionIds.push(session.sessionId);

    const result = await session.exec('cat', ['/sys/fs/cgroup/memory.max']);
    expect(result.exitCode).toBe(0);
    expect(parseInt(result.stdout.trim(), 10)).toBe(67108864);

    await session.destroy();
  });

  it('exec with cwd', async () => {
    const provider = createProvider();
    const session = await provider.createSession({});
    createdSessionIds.push(session.sessionId);

    const result = await session.exec('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp');

    await session.destroy();
  });

  it('exec with env', async () => {
    const provider = createProvider();
    const session = await provider.createSession({});
    createdSessionIds.push(session.sessionId);

    const result = await session.exec('sh', ['-c', 'echo $MY_VAR'], { env: { MY_VAR: 'injected' } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('injected');

    await session.destroy();
  });

  it('destroy is idempotent (real sandbox)', async () => {
    const provider = createProvider();
    const session = await provider.createSession({});
    createdSessionIds.push(session.sessionId);

    await session.destroy();
    await session.destroy(); // Should not throw
  });

  it('exec after destroy throws', async () => {
    const provider = createProvider();
    const session = await provider.createSession({});
    createdSessionIds.push(session.sessionId);

    await session.destroy();
    await expect(session.exec('echo', ['nope'])).rejects.toThrow('destroyed');
  });
});
