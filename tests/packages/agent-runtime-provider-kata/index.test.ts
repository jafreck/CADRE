import { describe, it, expect } from 'vitest';
import * as indexExports from '../../../packages/agent-runtime-provider-kata/src/index.js';

describe('index public exports', () => {
  it('should export KataProvider', () => {
    expect(indexExports.KataProvider).toBeDefined();
    expect(typeof indexExports.KataProvider).toBe('function');
  });

  it('should export createKataProvider', () => {
    expect(indexExports.createKataProvider).toBeDefined();
    expect(typeof indexExports.createKataProvider).toBe('function');
  });

  it('should export CapabilityMismatchError', () => {
    expect(indexExports.CapabilityMismatchError).toBeDefined();
    expect(typeof indexExports.CapabilityMismatchError).toBe('function');
  });

  it('should export a functional KataProvider from the public surface', () => {
    const provider = new indexExports.KataProvider();
    expect(typeof provider.startSession).toBe('function');
    expect(typeof provider.exec).toBe('function');
    expect(typeof provider.stopSession).toBe('function');
    expect(typeof provider.destroySession).toBe('function');
  });

  it('should export a functional createKataProvider factory from the public surface', () => {
    const provider = indexExports.createKataProvider();
    expect(provider).toBeInstanceOf(indexExports.KataProvider);
  });

  it('should export a functional CapabilityMismatchError from the public surface', () => {
    const err = new indexExports.CapabilityMismatchError(['cpu']);
    expect(err).toBeInstanceOf(Error);
    expect(err.unsupportedPolicies).toEqual(['cpu']);
  });
});
