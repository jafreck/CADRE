import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../src/runtime/registry.js';
import type { IsolationProvider, IsolationCapabilities, IsolationPolicy, IsolationSession } from '../../src/runtime/types.js';

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

  it('has() returns true for registered providers', () => {
    registry.register(makeProvider('host'));
    expect(registry.has('host')).toBe(true);
    expect(registry.has('docker')).toBe(false);
  });

  it('has() returns true for factory-registered providers', () => {
    registry.registerFactory('docker', () => makeProvider('docker'));
    expect(registry.has('docker')).toBe(true);
  });

  it('list() returns all registered names', () => {
    registry.register(makeProvider('host'));
    registry.registerFactory('docker', () => makeProvider('docker'));
    expect(registry.list().sort()).toEqual(['docker', 'host']);
  });

  it('list() deduplicates names present in both maps', () => {
    registry.register(makeProvider('host'));
    registry.registerFactory('host', () => makeProvider('host'));
    expect(registry.list()).toEqual(['host']);
  });

  it('resolve() instantiates lazy factories on first call', () => {
    let called = 0;
    registry.registerFactory('docker', () => { called++; return makeProvider('docker'); });
    expect(called).toBe(0);
    registry.resolve('docker');
    expect(called).toBe(1);
    // Second resolve uses cached instance
    registry.resolve('docker');
    expect(called).toBe(1);
  });

  it('resolve() prefers direct registration over factory', () => {
    const direct = makeProvider('docker');
    registry.register(direct);
    registry.registerFactory('docker', () => makeProvider('docker'));
    expect(registry.resolve('docker')).toBe(direct);
  });

  it('unregister() removes providers', () => {
    registry.register(makeProvider('host'));
    registry.unregister('host');
    expect(registry.has('host')).toBe(false);
  });

  it('unregister() removes factory-registered providers', () => {
    registry.registerFactory('docker', () => makeProvider('docker'));
    registry.unregister('docker');
    expect(registry.has('docker')).toBe(false);
  });

  it('registerProvider() accepts instance registrations', () => {
    const provider = makeProvider('host');
    registry.registerProvider({ name: 'host', provider });
    expect(registry.resolve('host')).toBe(provider);
  });

  it('registerProviders() accepts mixed registrations', () => {
    const provider = makeProvider('host');
    registry.registerProviders([
      { name: 'host', provider },
      { name: 'docker', factory: () => makeProvider('docker') },
    ]);
    expect(registry.has('host')).toBe(true);
    expect(registry.has('docker')).toBe(true);
  });

  it('getCapabilities() returns provider capabilities', () => {
    registry.register(makeProvider('host'));
    expect(registry.getCapabilities('host')?.networkModes).toEqual(['none', 'allowlist', 'full']);
  });

  it('healthCheck() treats providers without healthCheck as healthy', async () => {
    registry.register(makeProvider('host'));
    await expect(registry.healthCheck('host')).resolves.toEqual(
      expect.objectContaining({ healthy: true }),
    );
  });

  it('describe() reports registered provider metadata', () => {
    registry.register(makeProvider('host'));
    registry.registerFactory('docker', () => makeProvider('docker'));

    const descriptions = registry.describe();
    expect(descriptions.map((d) => d.name)).toEqual(['docker', 'host']);
    expect(descriptions.find((d) => d.name === 'host')?.registeredAs).toBe('instance');
    expect(descriptions.find((d) => d.name === 'docker')?.registeredAs).toBe('factory');
  });
});
