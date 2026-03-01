import { describe, it, expect, vi } from 'vitest';
import * as pkg from '../../../packages/agent-runtime-provider-docker/src/index.js';

describe('@cadre/agent-runtime-provider-docker barrel exports', () => {
  it('should export DockerProvider', () => {
    expect(typeof pkg.DockerProvider).toBe('function');
  });

  it('should export DockerSession', () => {
    expect(typeof pkg.DockerSession).toBe('function');
  });

  it('DockerProvider should be instantiable with required options', () => {
    const provider = new pkg.DockerProvider({ image: 'ubuntu:22.04' });
    expect(provider).toBeDefined();
    expect(provider.name).toBe('docker');
  });

  it('DockerSession should be instantiable with required options', () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const session = new pkg.DockerSession({ containerId: 'test-id', runner });
    expect(session).toBeDefined();
    expect(session.sessionId).toBe('test-id');
  });
});
