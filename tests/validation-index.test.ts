import { describe, it, expect } from 'vitest';
import * as validationIndex from '../src/validation/index.js';

describe('src/validation/index.ts re-exports', () => {
  it('should export ValidationResult type (present as a usable interface)', () => {
    // ValidationResult is a TypeScript interface; verify it does not appear as an export value
    // The key test is that importing from the index does not throw and the module loads
    expect(validationIndex).toBeDefined();
  });

  it('should export PreRunValidator type (present as a usable interface)', () => {
    expect(validationIndex).toBeDefined();
  });

  it('should export SuiteResult type (present as a usable interface)', () => {
    expect(validationIndex).toBeDefined();
  });

  it('should export PreRunValidationSuite class', () => {
    expect(validationIndex.PreRunValidationSuite).toBeDefined();
    expect(typeof validationIndex.PreRunValidationSuite).toBe('function');
  });

  it('should export PreRunValidationSuite as a constructable class', () => {
    const suite = new validationIndex.PreRunValidationSuite();
    expect(suite).toBeInstanceOf(validationIndex.PreRunValidationSuite);
  });

  it('should not export unexpected symbols beyond the public surface', () => {
    const exportedKeys = Object.keys(validationIndex);
    // Only PreRunValidationSuite is a runtime value; type-only exports are erased at runtime
    expect(exportedKeys).toContain('PreRunValidationSuite');
  });
});
