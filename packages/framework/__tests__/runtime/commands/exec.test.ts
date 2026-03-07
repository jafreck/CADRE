import { describe, it, expect, vi } from 'vitest';
import { spawnProcess } from '../../../src/runtime/commands/exec.js';

describe('spawnProcess onData callback', () => {
  it('calls onData for each stdout chunk with stream === "stdout"', async () => {
    const chunks: Array<{ chunk: string; stream: string }> = [];
    const onData = vi.fn((chunk: string, stream: 'stdout' | 'stderr') => {
      chunks.push({ chunk, stream });
    });

    const { promise } = spawnProcess('echo', ['hello'], { onData });
    await promise;

    const stdoutChunks = chunks.filter(c => c.stream === 'stdout');
    expect(stdoutChunks.length).toBeGreaterThan(0);
    expect(stdoutChunks.map(c => c.chunk).join('')).toContain('hello');
  });

  it('calls onData for each stderr chunk with stream === "stderr"', async () => {
    const chunks: Array<{ chunk: string; stream: string }> = [];
    const onData = vi.fn((chunk: string, stream: 'stdout' | 'stderr') => {
      chunks.push({ chunk, stream });
    });

    // Write to stderr using a shell command
    const { promise } = spawnProcess('sh', ['-c', 'echo errdata >&2'], { onData });
    await promise;

    const stderrChunks = chunks.filter(c => c.stream === 'stderr');
    expect(stderrChunks.length).toBeGreaterThan(0);
    expect(stderrChunks.map(c => c.chunk).join('')).toContain('errdata');
  });

  it('does not throw when onData is absent', async () => {
    const { promise } = spawnProcess('echo', ['no-callback']);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('no-callback');
  });

  it('buffered ProcessResult.stdout and stderr are correct when onData is wired', async () => {
    const onData = vi.fn();
    const { promise } = spawnProcess('sh', ['-c', 'echo outdata; echo errdata >&2'], { onData });
    const result = await promise;

    expect(result.stdout).toContain('outdata');
    expect(result.stderr).toContain('errdata');
    expect(onData).toHaveBeenCalled();
  });
});
