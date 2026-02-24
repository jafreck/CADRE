import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { PreRunValidator, ValidationResult } from '../src/validation/types.js';
import { PreRunValidationSuite } from '../src/validation/suite.js';

const makeConfig = () => makeRuntimeConfig();

const makeValidator = (name: string, result: ValidationResult): PreRunValidator => ({
  name,
  validate: vi.fn().mockResolvedValue(result),
});

const pass = (warnings: string[] = []): ValidationResult => ({ passed: true, errors: [], warnings });
const fail = (errors: string[] = [], warnings: string[] = []): ValidationResult => ({
  passed: false,
  errors,
  warnings,
});

describe('PreRunValidationSuite', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('return value', () => {
    it('should return true when all validators pass with no warnings', async () => {
      const suite = new PreRunValidationSuite([makeValidator('a', pass()), makeValidator('b', pass())]);
      expect(await suite.run(makeConfig())).toBe(true);
    });

    it('should return true when all validators pass with warnings', async () => {
      const suite = new PreRunValidationSuite([makeValidator('a', pass(['some warning']))]);
      expect(await suite.run(makeConfig())).toBe(true);
    });

    it('should return false when any validator fails', async () => {
      const suite = new PreRunValidationSuite([makeValidator('a', pass()), makeValidator('b', fail(['bad thing']))]);
      expect(await suite.run(makeConfig())).toBe(false);
    });

    it('should return false when all validators fail', async () => {
      const suite = new PreRunValidationSuite([makeValidator('a', fail(['err'])), makeValidator('b', fail(['err2']))]);
      expect(await suite.run(makeConfig())).toBe(false);
    });

    it('should return true with an empty validators list', async () => {
      const suite = new PreRunValidationSuite([]);
      expect(await suite.run(makeConfig())).toBe(true);
    });

    it('should return false when a validator promise rejects', async () => {
      const bad: PreRunValidator = { name: 'boom', validate: vi.fn().mockRejectedValue(new Error('exploded')) };
      const suite = new PreRunValidationSuite([bad]);
      expect(await suite.run(makeConfig())).toBe(false);
    });
  });

  describe('console output', () => {
    it('should print ✅ for a passing validator with no warnings', async () => {
      const suite = new PreRunValidationSuite([makeValidator('git', pass())]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('✅ git');
    });

    it('should print ⚠️ for a passing validator with warnings', async () => {
      const suite = new PreRunValidationSuite([makeValidator('git', pass(['remote unreachable']))]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('⚠️  git');
    });

    it('should print ❌ for a failing validator', async () => {
      const suite = new PreRunValidationSuite([makeValidator('git', fail(['missing .git']))]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('❌ git');
    });

    it('should print error messages indented below the validator line', async () => {
      const suite = new PreRunValidationSuite([makeValidator('platform', fail(['missing dep', 'bad version']))]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('  missing dep');
      expect(consoleSpy).toHaveBeenCalledWith('  bad version');
    });

    it('should print warning messages indented below the validator line', async () => {
      const suite = new PreRunValidationSuite([makeValidator('platform', pass(['warn-1', 'warn-2']))]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('  warn-1');
      expect(consoleSpy).toHaveBeenCalledWith('  warn-2');
    });

    it('should print ❌ (unknown validator) when a validator promise rejects', async () => {
      const bad: PreRunValidator = { name: 'boom', validate: vi.fn().mockRejectedValue('oops') };
      const suite = new PreRunValidationSuite([bad]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('❌ (unknown validator)');
    });

    it('should print the rejection reason for a rejected validator', async () => {
      const bad: PreRunValidator = { name: 'boom', validate: vi.fn().mockRejectedValue('oops') };
      const suite = new PreRunValidationSuite([bad]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('  oops');
    });

    it('should print output for all validators', async () => {
      const suite = new PreRunValidationSuite([
        makeValidator('a', pass()),
        makeValidator('b', pass(['w'])),
        makeValidator('c', fail(['e'])),
      ]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('✅ a');
      expect(consoleSpy).toHaveBeenCalledWith('⚠️  b');
      expect(consoleSpy).toHaveBeenCalledWith('❌ c');
    });
  });

  describe('concurrency', () => {
    it('should call validate on all validators', async () => {
      const v1 = makeValidator('a', pass());
      const v2 = makeValidator('b', pass());
      const suite = new PreRunValidationSuite([v1, v2]);
      await suite.run(makeConfig());
      expect(v1.validate).toHaveBeenCalledOnce();
      expect(v2.validate).toHaveBeenCalledOnce();
    });

    it('should pass config to each validator', async () => {
      const v = makeValidator('a', pass());
      const suite = new PreRunValidationSuite([v]);
      const config = makeConfig();
      await suite.run(config);
      expect(v.validate).toHaveBeenCalledWith(config);
    });

    it('should still report passing validators even when one fails', async () => {
      const suite = new PreRunValidationSuite([makeValidator('ok', pass()), makeValidator('bad', fail(['err']))]);
      await suite.run(makeConfig());
      expect(consoleSpy).toHaveBeenCalledWith('✅ ok');
      expect(consoleSpy).toHaveBeenCalledWith('❌ bad');
    });
  });
});
