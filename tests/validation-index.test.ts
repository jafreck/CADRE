import { describe, it, expect } from 'vitest';
import {
  PreRunValidationSuite,
  gitValidator,
  agentBackendValidator,
  platformValidator,
  commandValidator,
  diskValidator,
} from '../src/validation/index.js';
import type { ValidationResult, PreRunValidator } from '../src/validation/index.js';

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

    it('should export all five validators with distinct names', () => {
      const names = [
        gitValidator.name,
        agentBackendValidator.name,
        platformValidator.name,
        commandValidator.name,
        diskValidator.name,
      ];
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(5);
    });
  });
});
