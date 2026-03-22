import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DockerProvider } from '../docker-provider.js';

const SKIP = process.env.CADRE_E2E_DOCKER !== '1';

// Use a minimal image for speed
const IMAGE = 'alpine:3';

function dockerExec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile('docker', args, (error, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: error ? 1 : 0 });
    });
  });
}

(SKIP ? describe.skip : describe)('DockerProvider E2E (requires Docker)', () => {
  const sessionIds: string[] = [];

  afterAll(async () => {
    // Force-remove any containers that might still be running
    if (sessionIds.length > 0) {
      await dockerExec(['rm', '--force', ...sessionIds]).catch(() => {});
    }
  });

  it('healthCheck() against real Docker daemon', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.details?.version).toBeTruthy();
    expect(typeof result.details?.version).toBe('string');
  });

  it('full lifecycle: create → exec → destroy', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({});
    sessionIds.push(session.sessionId);

    const result = await session.exec('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');

    await session.destroy();

    // Verify the container is gone
    const check = await dockerExec(['ps', '-a', '--filter', `id=${session.sessionId}`, '--format', '{{.ID}}']);
    expect(check.stdout.trim()).toBe('');
  });

  it('network isolation mode none', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({ networkMode: 'none' });
    sessionIds.push(session.sessionId);

    const result = await session.exec('ping', ['-c', '1', '-W', '2', '8.8.8.8']);
    expect(result.exitCode).not.toBe(0);

    await session.destroy();
  });

  it('resource limits (memory)', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({ resources: { memoryMb: 32 } });
    sessionIds.push(session.sessionId);

    // Try cgroup v2 first, fall back to cgroup v1
    let result = await session.exec('cat', ['/sys/fs/cgroup/memory.max']);
    if (result.exitCode !== 0) {
      result = await session.exec('cat', ['/sys/fs/cgroup/memory/memory.limit_in_bytes']);
    }
    expect(result.exitCode).toBe(0);
    const memoryLimit = parseInt(result.stdout.trim(), 10);
    expect(memoryLimit).toBe(32 * 1024 * 1024);

    await session.destroy();
  });

  it('working directory via worktreePath mount', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cadre-e2e-'));
    const testContent = 'cadre-e2e-test-content';
    const testFilename = 'test-file.txt';
    await writeFile(join(tempDir, testFilename), testContent);

    try {
      const provider = new DockerProvider({ image: IMAGE, worktreePath: tempDir });
      const session = await provider.createSession({});
      sessionIds.push(session.sessionId);

      const result = await session.exec('cat', [`/workspace/${testFilename}`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(testContent);

      await session.destroy();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it('env allowlist forwarding', async () => {
    process.env.CADRE_E2E_TEST_VAR = 'hello_e2e';
    try {
      const provider = new DockerProvider({ image: IMAGE });
      const session = await provider.createSession({ envAllowlist: ['CADRE_E2E_TEST_VAR'] });
      sessionIds.push(session.sessionId);

      const result = await session.exec('sh', ['-c', 'echo $CADRE_E2E_TEST_VAR']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello_e2e');

      await session.destroy();
    } finally {
      delete process.env.CADRE_E2E_TEST_VAR;
    }
  });

  it('exec with cwd option', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({});
    sessionIds.push(session.sessionId);

    const result = await session.exec('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp');

    await session.destroy();
  });

  it('exec with env option', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({});
    sessionIds.push(session.sessionId);

    const result = await session.exec('sh', ['-c', 'echo $MY_VAR'], { env: { MY_VAR: 'injected' } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('injected');

    await session.destroy();
  });

  it('destroy is idempotent (real container)', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({});
    sessionIds.push(session.sessionId);

    await session.destroy();
    await session.destroy(); // Should also succeed, no throw
  });

  it('exec after destroy throws', async () => {
    const provider = new DockerProvider({ image: IMAGE });
    const session = await provider.createSession({});
    sessionIds.push(session.sessionId);

    await session.destroy();
    await expect(session.exec('echo', ['nope'])).rejects.toThrow(/destroyed/);
  });
});
