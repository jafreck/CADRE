import { describe, it, expect } from 'vitest';
import type { ValidationResult, PreRunValidator } from '../src/validation/types.js';
import { CadreConfigSchema } from '../src/config/schema.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

describe('ValidationResult', () => {
  it('should accept a passing result with empty arrays', () => {
    const result: ValidationResult = { passed: true, warnings: [], errors: [] };
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a failing result with errors', () => {
    const result: ValidationResult = {
      passed: false,
      warnings: [],
      errors: ['Missing required field'],
    };
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Missing required field');
  });

  it('should accept warnings alongside a passing result', () => {
    const result: ValidationResult = {
      passed: true,
      warnings: ['Deprecated option used'],
      errors: [],
    };
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain('Deprecated option used');
  });

  it('should accept the optional name field', () => {
    const result: ValidationResult = {
      passed: true,
      warnings: [],
      errors: [],
      name: 'my-validator',
    };
    expect(result.name).toBe('my-validator');
  });

  it('should work without the optional name field', () => {
    const result: ValidationResult = { passed: false, warnings: [], errors: ['error'] };
    expect(result.name).toBeUndefined();
  });

  it('should support multiple warnings and errors', () => {
    const result: ValidationResult = {
      passed: false,
      warnings: ['warn1', 'warn2'],
      errors: ['err1', 'err2', 'err3'],
    };
    expect(result.warnings).toHaveLength(2);
    expect(result.errors).toHaveLength(3);
  });
});

describe('PreRunValidator', () => {
  it('should allow a validator that returns a passing result', async () => {
    const validator: PreRunValidator = {
      name: 'always-pass',
      validate: async (_config) => ({ passed: true, warnings: [], errors: [] }),
    };

    const result = await validator.validate(baseConfig);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should allow a validator that returns a failing result', async () => {
    const validator: PreRunValidator = {
      name: 'always-fail',
      validate: async (_config) => ({
        passed: false,
        warnings: [],
        errors: ['Validation failed'],
      }),
    };

    const result = await validator.validate(baseConfig);
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Validation failed');
  });

  it('should expose the validator name', () => {
    const validator: PreRunValidator = {
      name: 'my-validator',
      validate: async (_config) => ({ passed: true, warnings: [], errors: [] }),
    };

    expect(validator.name).toBe('my-validator');
  });

  it('should receive the config and use it in validation', async () => {
    const validator: PreRunValidator = {
      name: 'repo-checker',
      validate: async (config) => {
        if (!config.repository.includes('/')) {
          return { passed: false, warnings: [], errors: ['Repository must be in owner/repo format'] };
        }
        return { passed: true, warnings: [], errors: [] };
      },
    };

    const passing = await validator.validate(baseConfig);
    expect(passing.passed).toBe(true);
  });

  it('should return a result that includes an optional name from the validator', async () => {
    const validator: PreRunValidator = {
      name: 'named-result-validator',
      validate: async (_config) => ({
        passed: true,
        warnings: [],
        errors: [],
        name: 'named-result-validator',
      }),
    };

    const result = await validator.validate(baseConfig);
    expect(result.name).toBe('named-result-validator');
  });

  it('should return a Promise<ValidationResult>', async () => {
    const validator: PreRunValidator = {
      name: 'async-validator',
      validate: (_config) =>
        Promise.resolve({ passed: true, warnings: ['minor issue'], errors: [] }),
    };

    const resultPromise = validator.validate(baseConfig);
    expect(resultPromise).toBeInstanceOf(Promise);
    const result = await resultPromise;
    expect(result.warnings).toContain('minor issue');
  });
});
