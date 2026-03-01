import { describe, it, expect, vi } from 'vitest';
import { createKataProvider } from '../../../packages/agent-runtime-provider-kata/src/registry.js';
import { KataProvider } from '../../../packages/agent-runtime-provider-kata/src/kata-provider.js';
import type { KataAdapter } from '../../../packages/agent-runtime-provider-kata/src/kata-provider.js';

describe('createKataProvider', () => {
  it('should return a KataProvider instance', () => {
    const provider = createKataProvider();
    expect(provider).toBeInstanceOf(KataProvider);
  });

  it('should pass the custom adapter to the KataProvider', async () => {
    const mockAdapter: KataAdapter = {
      createSandbox: vi.fn().mockResolvedValue(undefined),
      execInSandbox: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'custom', stderr: '' }),
      stopSandbox: vi.fn().mockResolvedValue(undefined),
      destroySandbox: vi.fn().mockResolvedValue(undefined),
    };

    const provider = createKataProvider(mockAdapter);
    const sessionId = await provider.startSession({});
    const result = await provider.exec(sessionId, ['echo', 'test']);

    expect(mockAdapter.createSandbox).toHaveBeenCalledOnce();
    expect(mockAdapter.execInSandbox).toHaveBeenCalledWith(sessionId, ['echo', 'test']);
    expect(result.stdout).toBe('custom');
  });

  it('should return a provider that implements the IsolationProvider interface', () => {
    const provider = createKataProvider();
    expect(typeof provider.startSession).toBe('function');
    expect(typeof provider.exec).toBe('function');
    expect(typeof provider.stopSession).toBe('function');
    expect(typeof provider.destroySession).toBe('function');
  });
});
