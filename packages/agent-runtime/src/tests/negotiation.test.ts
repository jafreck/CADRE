import { describe, it, expect } from 'vitest';
import { negotiatePolicy, CapabilityMismatchError } from '../negotiation.js';
import type { IsolationProvider, IsolationCapabilities, IsolationPolicy, IsolationSession, NetworkMode } from '../types.js';

function makeProvider(name: string, caps: Partial<IsolationCapabilities> = {}): IsolationProvider {
  const defaults: IsolationCapabilities = {
    mounts: true,
    networkModes: ['none', 'allowlist', 'full'],
    envAllowlist: true,
    secrets: true,
    resources: true,
  };
  return {
    name,
    capabilities(): IsolationCapabilities {
      return { ...defaults, ...caps };
    },
    async createSession(_policy: IsolationPolicy): Promise<IsolationSession> {
      return {
        sessionId: `${name}-session`,
        async exec() { return { exitCode: 0, stdout: '', stderr: '' }; },
        async destroy() {},
      };
    },
  };
}

const fullPolicy: IsolationPolicy = {
  mounts: [{ path: '/workspace', readOnly: false }],
  networkMode: 'none' as NetworkMode,
  envAllowlist: ['HOME'],
  secrets: [{ name: 'TOKEN', value: 'secret' }],
  resources: { memoryMb: 512, timeoutMs: 30000 },
};

describe('negotiatePolicy', () => {
  it('returns the provider when all capabilities match', () => {
    const provider = makeProvider('docker');
    const result = negotiatePolicy(provider, fullPolicy);
    expect(result).toBe(provider);
  });

  it('throws CapabilityMismatchError when mounts are required but unsupported', () => {
    const provider = makeProvider('host', { mounts: false });
    expect(() => negotiatePolicy(provider, { mounts: [{ path: '/x', readOnly: true }] }))
      .toThrow(CapabilityMismatchError);
  });

  it('CapabilityMismatchError includes provider name and mismatched attributes', () => {
    const provider = makeProvider('host', { mounts: false, resources: false });
    try {
      negotiatePolicy(provider, { mounts: [{ path: '/x', readOnly: true }], resources: { memoryMb: 512 } });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityMismatchError);
      const e = err as CapabilityMismatchError;
      expect(e.providerName).toBe('host');
      expect(e.mismatchedAttributes).toContain('mounts');
      expect(e.mismatchedAttributes).toContain('resources');
      expect(e.message).toMatch(/host/);
      expect(e.message).toMatch(/mounts/);
    }
  });

  it('does not silently downgrade — throws even when fallback is unavailable', () => {
    const provider = makeProvider('docker', { mounts: false });
    expect(() => negotiatePolicy(provider, { mounts: [{ path: '/x', readOnly: false }] }, { allowFallbackToHost: false }))
      .toThrow(CapabilityMismatchError);
  });

  it('falls back to host provider when allowFallbackToHost is true and mismatch exists', () => {
    const docker = makeProvider('docker', { mounts: false });
    const host = makeProvider('host');
    const result = negotiatePolicy(docker, { mounts: [{ path: '/x', readOnly: false }] }, {
      allowFallbackToHost: true,
      hostProvider: host,
    });
    expect(result).toBe(host);
  });

  it('throws when allowFallbackToHost is true but no hostProvider is provided', () => {
    const docker = makeProvider('docker', { mounts: false });
    expect(() => negotiatePolicy(docker, { mounts: [{ path: '/x', readOnly: false }] }, { allowFallbackToHost: true }))
      .toThrow(CapabilityMismatchError);
  });

  it('does not fall back when allowFallbackToHost is absent', () => {
    const docker = makeProvider('docker', { resources: false });
    const host = makeProvider('host');
    expect(() => negotiatePolicy(docker, { resources: { memoryMb: 256 } }, { hostProvider: host }))
      .toThrow(CapabilityMismatchError);
  });

  it('throws when requested networkMode is unsupported', () => {
    const provider = makeProvider('limited', { networkModes: ['none'] });
    expect(() => negotiatePolicy(provider, { networkMode: 'full' }))
      .toThrow(CapabilityMismatchError);
  });

  it('throws when envAllowlist is required but unsupported', () => {
    const provider = makeProvider('host', { envAllowlist: false });
    expect(() => negotiatePolicy(provider, { envAllowlist: ['HOME'] }))
      .toThrow(CapabilityMismatchError);
  });

  it('throws when secrets are required but unsupported', () => {
    const provider = makeProvider('host', { secrets: false });
    expect(() => negotiatePolicy(provider, { secrets: [{ name: 'TOKEN', value: 'abc' }] }))
      .toThrow(CapabilityMismatchError);
  });

  it('CapabilityMismatchError has correct error name', () => {
    const provider = makeProvider('host', { mounts: false });
    try {
      negotiatePolicy(provider, { mounts: [{ path: '/x', readOnly: true }] });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('CapabilityMismatchError');
    }
  });

  it('does not throw when policy has empty mounts array', () => {
    const provider = makeProvider('host', { mounts: false });
    const result = negotiatePolicy(provider, { mounts: [] });
    expect(result).toBe(provider);
  });

  it('does not throw when policy has empty envAllowlist array', () => {
    const provider = makeProvider('host', { envAllowlist: false });
    const result = negotiatePolicy(provider, { envAllowlist: [] });
    expect(result).toBe(provider);
  });

  it('does not throw when policy has empty secrets array', () => {
    const provider = makeProvider('host', { secrets: false });
    const result = negotiatePolicy(provider, { secrets: [] });
    expect(result).toBe(provider);
  });

  it('mismatchedAttributes list includes networkMode with mode name', () => {
    const provider = makeProvider('limited', { networkModes: ['none'] });
    try {
      negotiatePolicy(provider, { networkMode: 'allowlist' });
      expect.fail('should have thrown');
    } catch (err) {
      const e = err as CapabilityMismatchError;
      expect(e.mismatchedAttributes).toContain('networkMode(allowlist)');
    }
  });
});
