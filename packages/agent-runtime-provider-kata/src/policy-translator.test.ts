import { describe, it, expect } from 'vitest';
import { CapabilityMismatchError } from '@cadre/agent-runtime';
import { translatePolicy } from './policy-translator.js';

describe('translatePolicy', () => {
  it('maps a full policy to KataSessionConfig', () => {
    const config = translatePolicy({
      resources: { memoryMb: 512, cpuShares: 2 },
      networkMode: 'none',
    });

    expect(config.runtime).toBe('io.containerd.kata.v2');
    expect(config.memoryLimitBytes).toBe(512 * 1024 * 1024);
    expect(config.cpuQuota).toBe(2);
    expect(config.networkIsolation).toBe(true);
    expect(config.readOnlyRootfs).toBe(false);
  });

  it('maps a partial policy with defaults for unset fields', () => {
    const config = translatePolicy({ resources: { memoryMb: 256 } });

    expect(config.memoryLimitBytes).toBe(256 * 1024 * 1024);
    expect(config.cpuQuota).toBeUndefined();
    expect(config.networkIsolation).toBe(false);
    expect(config.readOnlyRootfs).toBe(false);
  });

  it('returns defaults for an empty policy', () => {
    const config = translatePolicy({});

    expect(config.runtime).toBe('io.containerd.kata.v2');
    expect(config.memoryLimitBytes).toBeUndefined();
    expect(config.cpuQuota).toBeUndefined();
    expect(config.networkIsolation).toBe(false);
    expect(config.readOnlyRootfs).toBe(false);
  });

  it('sets networkIsolation true when networkMode is "none"', () => {
    const config = translatePolicy({ networkMode: 'none' });
    expect(config.networkIsolation).toBe(true);
  });

  it('sets networkIsolation false when networkMode is "full"', () => {
    const config = translatePolicy({ networkMode: 'full' });
    expect(config.networkIsolation).toBe(false);
  });

  it('throws CapabilityMismatchError for envAllowlist', () => {
    expect(() =>
      translatePolicy({ envAllowlist: ['HOME'] }),
    ).toThrow(CapabilityMismatchError);
  });

  it('throws CapabilityMismatchError for secrets', () => {
    expect(() =>
      translatePolicy({ secrets: [{ name: 'tok', value: 'x' }] }),
    ).toThrow(CapabilityMismatchError);
  });

  it('includes all unsupported fields in the error', () => {
    try {
      translatePolicy({ envAllowlist: ['HOME'], secrets: [{ name: 'tok', value: 'x' }] });
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityMismatchError);
      const e = err as CapabilityMismatchError;
      expect(e.mismatchedAttributes).toContain('envAllowlist');
      expect(e.mismatchedAttributes).toContain('secrets');
    }
  });
});
