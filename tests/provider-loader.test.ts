import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from '../src/platform/provider-loader.js';

describe('createProviderRegistry', () => {
  it('registers host provider by default', () => {
    const reg = createProviderRegistry();
    const provider = reg.resolve(undefined, 'host');
    expect(provider.name).toBe('host');
  });

  it('has docker and kata factory-registered', () => {
    const reg = createProviderRegistry({ dockerImage: 'node:20' });
    expect(reg.has('docker')).toBe(true);
    expect(reg.has('kata')).toBe(true);
  });

  it('lists all built-in providers', () => {
    const reg = createProviderRegistry();
    expect(reg.list().sort()).toEqual(['docker', 'host', 'kata']);
  });

  it('resolves docker provider with image config', () => {
    const reg = createProviderRegistry({ dockerImage: 'node:20' });
    const provider = reg.resolve('docker');
    expect(provider.name).toBe('docker');
  });

  it('throws when resolving docker without image config', () => {
    const reg = createProviderRegistry();
    expect(() => reg.resolve('docker')).toThrow('dockerImage');
  });

  it('resolves kata provider', () => {
    const reg = createProviderRegistry();
    const provider = reg.resolve('kata');
    expect(provider.name).toBe('kata');
  });

  it('resolves kata provider with docker backend', () => {
    const reg = createProviderRegistry({ kata: { backend: 'docker', image: 'ubuntu:22.04' } });
    const provider = reg.resolve('kata');
    expect(provider.name).toBe('kata');
  });

  it('resolves kata provider with nerdctl backend by default', () => {
    const reg = createProviderRegistry({ kata: { image: 'alpine:3' } });
    const provider = reg.resolve('kata');
    expect(provider.name).toBe('kata');
  });

  it('defaults to host when no override or config is given', () => {
    const reg = createProviderRegistry();
    const provider = reg.resolve();
    expect(provider.name).toBe('host');
  });
});
