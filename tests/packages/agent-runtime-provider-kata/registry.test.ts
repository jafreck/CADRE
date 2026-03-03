import { describe, it, expect, vi } from 'vitest';
import { createKataProvider } from '../../../packages/runtime-provider-kata/src/registry.js';
import { KataProvider } from '../../../packages/runtime-provider-kata/src/kata-provider.js';
import type { KataAdapter } from '../../../packages/runtime-provider-kata/src/kata-provider.js';

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
    const session = await provider.createSession({});
    const result = await session.exec('echo', ['test']);

    expect(mockAdapter.createSandbox).toHaveBeenCalledOnce();
    expect(mockAdapter.execInSandbox).toHaveBeenCalled();
    expect(result.stdout).toBe('custom');
  });

  it('should return a provider that implements the canonical IsolationProvider interface', () => {
    const provider = createKataProvider();
    expect(provider.name).toBe('kata');
    expect(typeof provider.capabilities).toBe('function');
    expect(typeof provider.createSession).toBe('function');
  });
});
