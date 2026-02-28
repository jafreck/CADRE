import { describe, it, expect } from 'vitest';
import {
  PreRunValidationSuite,
  gitValidator,
  agentBackendValidator,
  platformValidator,
  commandValidator,
  diskValidator,
  registryCompletenessValidator,
  checkStaleState,
  resolveStaleState,
} from '../src/validation/index.js';
import type { ValidationResult, PreRunValidator, StaleConflict, StaleStateResult } from '../src/validation/index.js';

describe('src/validation/index.ts re-exports', () => {
  describe('type exports', () => {
    it('should export ValidationResult type usable as an object', () => {
      const result: ValidationResult = { passed: true, errors: [], warnings: [] };
      expect(result.passed).toBe(true);
    });

    it('should export PreRunValidator type usable as an object', () => {
      const validator: PreRunValidator = {
        name: 'test',
        validate: async () => ({ passed: true, errors: [], warnings: [] }),
      };
      expect(validator.name).toBe('test');
    });
  });

  describe('class exports', () => {
    it('should export PreRunValidationSuite as a constructable class', () => {
      const suite = new PreRunValidationSuite([]);
      expect(suite).toBeInstanceOf(PreRunValidationSuite);
    });

    it('PreRunValidationSuite from index should function correctly', async () => {
      const suite = new PreRunValidationSuite([]);
      const result = await suite.run({} as never);
      expect(result).toBe(true);
    });
  });

  describe('validator constant exports', () => {
    it('should export gitValidator with a name and validate function', () => {
      expect(typeof gitValidator.name).toBe('string');
      expect(typeof gitValidator.validate).toBe('function');
    });

    it('should export agentBackendValidator with a name and validate function', () => {
      expect(typeof agentBackendValidator.name).toBe('string');
      expect(typeof agentBackendValidator.validate).toBe('function');
    });

    it('should export platformValidator with a name and validate function', () => {
      expect(typeof platformValidator.name).toBe('string');
      expect(typeof platformValidator.validate).toBe('function');
    });

    it('should export commandValidator with a name and validate function', () => {
      expect(typeof commandValidator.name).toBe('string');
      expect(typeof commandValidator.validate).toBe('function');
    });

    it('should export diskValidator with a name and validate function', () => {
      expect(typeof diskValidator.name).toBe('string');
      expect(typeof diskValidator.validate).toBe('function');
    });

    it('should export registryCompletenessValidator with a name and validate function', () => {
      expect(typeof registryCompletenessValidator.name).toBe('string');
      expect(typeof registryCompletenessValidator.validate).toBe('function');
    });

    it('should export all six validators with distinct names', () => {
      const names = [
        gitValidator.name,
        agentBackendValidator.name,
        platformValidator.name,
        commandValidator.name,
        diskValidator.name,
        registryCompletenessValidator.name,
      ];
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(6);
    });
  });

  describe('stale-state validator exports', () => {
    it('should export checkStaleState as a function', () => {
      expect(typeof checkStaleState).toBe('function');
    });

    it('should export resolveStaleState as a function', () => {
      expect(typeof resolveStaleState).toBe('function');
    });

    it('should export StaleConflict type usable as an object', () => {
      const conflict: StaleConflict = { kind: 'worktree', description: 'test' };
      expect(conflict.kind).toBe('worktree');
    });

    it('should export StaleStateResult type usable as an object', () => {
      const result: StaleStateResult = { hasConflicts: false, conflicts: new Map() };
      expect(result.hasConflicts).toBe(false);
    });
  });
});
