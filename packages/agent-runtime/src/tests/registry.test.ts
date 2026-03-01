import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import type { IsolationProvider, IsolationCapabilities, IsolationPolicy, IsolationSession } from '../types.js';

function makeProvider(name: string): IsolationProvider {
  return {
    name,
    capabilities(): IsolationCapabilities {
      return {
        mounts: true,
        networkModes: ['none', 'allowlist', 'full'],
        envAllowlist: true,
        secrets: true,
        resources: true,
      };
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

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('resolves a registered provider by name', () => {
    const provider = makeProvider('docker');
    registry.register(provider);
    expect(registry.resolve('docker')).toBe(provider);
  });

  it('CLI override takes precedence over config provider', () => {
    const cli = makeProvider('docker');
    const config = makeProvider('host');
    registry.register(cli);
    registry.register(config);
    expect(registry.resolve('docker', 'host')).toBe(cli);
  });

  it('config provider is used when no CLI override is given', () => {
    const host = makeProvider('host');
    const docker = makeProvider('docker');
    registry.register(host);
    registry.register(docker);
    expect(registry.resolve(undefined, 'docker')).toBe(docker);
  });

  it('defaults to host provider when neither CLI override nor config provider is given', () => {
    const host = makeProvider('host');
    registry.register(host);
    expect(registry.resolve()).toBe(host);
  });

  it('throws a descriptive error for an unknown provider name', () => {
    expect(() => registry.resolve('nonexistent')).toThrowError(/Unknown isolation provider "nonexistent"/);
  });

  it('includes registered provider names in the error message', () => {
    registry.register(makeProvider('host'));
    expect(() => registry.resolve('missing')).toThrowError(/host/);
  });

  it('error message says (none) when no providers are registered', () => {
    expect(() => registry.resolve('missing')).toThrowError(/\(none\)/);
  });

  it('overwriting a provider replaces the previous registration', () => {
    const first = makeProvider('docker');
    const second = makeProvider('docker');
    registry.register(first);
    registry.register(second);
    expect(registry.resolve('docker')).toBe(second);
  });

  it('config provider is ignored when CLI override is provided', () => {
    const cli = makeProvider('sandbox');
    const config = makeProvider('docker');
    registry.register(cli);
    registry.register(config);
    expect(registry.resolve('sandbox', 'docker')).toBe(cli);
  });
});
