import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { DockerProvider } from '../docker-provider.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('DockerProvider default runner', () => {
  const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses execFile("docker", args, cb) and returns session id on success', async () => {
    execFileMock.mockImplementation((_file: string, _args: readonly string[], cb: (error: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, 'container-from-exec\n', '');
      return undefined as never;
    });

    const provider = new DockerProvider({ image: 'ubuntu:22.04' });
    const session = await provider.createSession({});

    expect(session.sessionId).toBe('container-from-exec');
    expect(execFile).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['run', '-d', '--init', 'ubuntu:22.04', 'sleep', 'infinity']),
      expect.any(Function)
    );
  });

  it('treats numeric error.code as non-zero exitCode', async () => {
    execFileMock.mockImplementation((_file: string, _args: readonly string[], cb: (error: Error | null, stdout: string, stderr: string) => void) => {
      const error = Object.assign(new Error('docker failed'), { code: 137 });
      cb(error, '', 'killed');
      return undefined as never;
    });

    const provider = new DockerProvider({ image: 'ubuntu:22.04' });
    await expect(provider.createSession({})).rejects.toThrow('Failed to start Docker container: killed');
  });

  it('treats non-numeric error.code as exitCode 1', async () => {
    execFileMock.mockImplementation((_file: string, _args: readonly string[], cb: (error: Error | null, stdout: string, stderr: string) => void) => {
      const error = Object.assign(new Error('docker failed'), { code: 'ENOENT' });
      cb(error, '', 'docker missing');
      return undefined as never;
    });

    const provider = new DockerProvider({ image: 'ubuntu:22.04' });
    await expect(provider.createSession({})).rejects.toThrow('Failed to start Docker container: docker missing');
  });
});
