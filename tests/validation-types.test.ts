import { describe, it, expect } from 'vitest';
import type { ValidationResult, PreRunValidator } from '../src/validation/types.js';
import type { CadreConfig } from '../src/config/schema.js';

describe('ValidationResult', () => {
  it('should allow a passing result with no errors or warnings', () => {
    const result: ValidationResult = { passed: true, errors: [], warnings: [] };
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should allow a failing result with errors', () => {
    const result: ValidationResult = { passed: false, errors: ['Missing field'], warnings: [] };
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Missing field');
  });

  it('should allow a passing result with warnings', () => {
    const result: ValidationResult = { passed: true, errors: [], warnings: ['Deprecated option used'] };
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain('Deprecated option used');
  });

  it('should allow multiple errors and warnings simultaneously', () => {
    const result: ValidationResult = {
      passed: false,
      errors: ['error-1', 'error-2'],
      warnings: ['warn-1'],
    };
    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('PreRunValidator', () => {
  it('should expose a name string', () => {
    const validator: PreRunValidator = {
      name: 'my-validator',
      validate: async (_config: CadreConfig) => ({ passed: true, errors: [], warnings: [] }),
    };
    expect(validator.name).toBe('my-validator');
  });

  it('should return a ValidationResult promise from validate()', async () => {
    const validator: PreRunValidator = {
      name: 'test-validator',
      validate: async (_config: CadreConfig) => ({
        passed: false,
        errors: ['bad config'],
        warnings: [],
      }),
    };

    const minimalConfig = {
      projectName: 'test',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      platform: 'github',
      issues: { ids: [1] },
    } as unknown as CadreConfig;

    const result = await validator.validate(minimalConfig);
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('bad config');
    expect(result.warnings).toHaveLength(0);
  });

  it('should allow a validator that resolves passed:true', async () => {
    const validator: PreRunValidator = {
      name: 'always-pass',
      validate: async (_config: CadreConfig) => ({ passed: true, errors: [], warnings: [] }),
    };

    const minimalConfig = {} as unknown as CadreConfig;
    const result = await validator.validate(minimalConfig);
    expect(result.passed).toBe(true);
  });

  it('should support multiple validators with distinct names', () => {
    const validators: PreRunValidator[] = [
      { name: 'validator-a', validate: async () => ({ passed: true, errors: [], warnings: [] }) },
      { name: 'validator-b', validate: async () => ({ passed: true, errors: [], warnings: [] }) },
    ];
    const names = validators.map((v) => v.name);
    expect(names).toContain('validator-a');
    expect(names).toContain('validator-b');
  });
});
