import { describe, it, expect } from 'vitest';
import { CapabilityMismatchError } from '../../../packages/agent-runtime-provider-kata/src/types.js';

describe('CapabilityMismatchError', () => {
  it('should be an instance of Error', () => {
    const err = new CapabilityMismatchError(['networkIsolation']);
    expect(err).toBeInstanceOf(Error);
  });

  it('should have name set to CapabilityMismatchError', () => {
    const err = new CapabilityMismatchError(['networkIsolation']);
    expect(err.name).toBe('CapabilityMismatchError');
  });

  it('should expose unsupportedPolicies on the instance', () => {
    const policies = ['networkIsolation', 'readOnlyRootfs'];
    const err = new CapabilityMismatchError(policies);
    expect(err.unsupportedPolicies).toEqual(policies);
  });

  it('should generate a default message listing unsupported policies', () => {
    const err = new CapabilityMismatchError(['networkIsolation', 'readOnlyRootfs']);
    expect(err.message).toContain('networkIsolation');
    expect(err.message).toContain('readOnlyRootfs');
  });

  it('should use a custom message when provided', () => {
    const custom = 'Custom error message';
    const err = new CapabilityMismatchError(['cpu'], custom);
    expect(err.message).toBe(custom);
  });

  it('should handle an empty unsupportedPolicies array', () => {
    const err = new CapabilityMismatchError([]);
    expect(err.unsupportedPolicies).toEqual([]);
    expect(err).toBeInstanceOf(CapabilityMismatchError);
  });

  it('should handle a single unsupported policy', () => {
    const err = new CapabilityMismatchError(['memory']);
    expect(err.unsupportedPolicies).toHaveLength(1);
    expect(err.unsupportedPolicies[0]).toBe('memory');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new CapabilityMismatchError(['networkIsolation']);
    }).toThrow(CapabilityMismatchError);
  });

  it('should be catchable as an Error', () => {
    expect(() => {
      throw new CapabilityMismatchError(['networkIsolation']);
    }).toThrow(Error);
  });
});
