import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostEstimator } from '../../src/core/cost-estimator.js';

describe('CostEstimator', () => {
  let estimator: CostEstimator;

  beforeEach(() => {
    estimator = new CostEstimator();
  });

  describe('estimate', () => {
    it('should estimate cost with default model', () => {
      const result = estimator.estimate(10000);
      expect(result.totalTokens).toBe(10000);
      expect(result.inputTokens).toBe(7500); // 75%
      expect(result.outputTokens).toBe(2500); // 25%
      expect(result.totalCost).toBeGreaterThan(0);
    });

    it('should estimate cost for specific model', () => {
      const result = estimator.estimate(10000, 'gpt-4o');
      expect(result.model).toBe('gpt-4o');
      // gpt-4o: input $0.005/1K, output $0.015/1K
      // 7500 input tokens = $0.0375
      // 2500 output tokens = $0.0375
      expect(result.inputCost).toBeCloseTo(0.0375, 4);
      expect(result.outputCost).toBeCloseTo(0.0375, 4);
      expect(result.totalCost).toBeCloseTo(0.075, 4);
    });

    it('should fall back to default for unknown model', () => {
      const result = estimator.estimate(1000, 'unknown-model');
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe('estimateDetailed', () => {
    it('should compute cost with explicit input/output counts', () => {
      const result = estimator.estimateDetailed(8000, 2000, 'gpt-4o');
      expect(result.inputTokens).toBe(8000);
      expect(result.outputTokens).toBe(2000);
      expect(result.totalTokens).toBe(10000);
      // input: 8 * 0.005 = $0.04, output: 2 * 0.015 = $0.03
      expect(result.inputCost).toBeCloseTo(0.04, 4);
      expect(result.outputCost).toBeCloseTo(0.03, 4);
    });
  });

  describe('format', () => {
    it('should format estimate as readable string', () => {
      const estimate = estimator.estimate(10000, 'gpt-4o');
      const formatted = estimator.format(estimate);
      expect(formatted).toContain('$');
      expect(formatted).toContain('10,000 tokens');
    });
  });

  describe('estimateIssueTokens', () => {
    it('should return the default 200,000 tokens when no argument is provided', () => {
      expect(estimator.estimateIssueTokens()).toBe(200_000);
    });

    it('should return the historical average when provided', () => {
      expect(estimator.estimateIssueTokens(150_000)).toBe(150_000);
    });

    it('should return zero when zero is explicitly provided', () => {
      expect(estimator.estimateIssueTokens(0)).toBe(0);
    });

    it('should return large values unchanged', () => {
      expect(estimator.estimateIssueTokens(1_000_000)).toBe(1_000_000);
    });
  });

  describe('cost overrides', () => {
    it('should use overridden costs when provided', () => {
      const custom = new CostEstimator({
        costOverrides: {
          'custom-model': { input: 0.01, output: 0.02 },
        },
      });

      const result = custom.estimate(1000, 'custom-model');
      // 750 input = 0.75 * 0.01 = $0.0075
      // 250 output = 0.25 * 0.02 = $0.005
      expect(result.inputCost).toBeCloseTo(0.0075, 4);
      expect(result.outputCost).toBeCloseTo(0.005, 4);
    });
  });

  describe('replaceable model table', () => {
    it('should replace built-in defaults when models config is provided', () => {
      const custom = new CostEstimator({
        models: {
          'my-model': { input: 0.001, output: 0.002 },
          'default': { input: 0.001, output: 0.002 },
        },
      });

      // Built-in gpt-4o should not be available
      const gptResult = custom.estimate(1000, 'gpt-4o');
      // Falls back to 'default' which is now our custom default
      expect(gptResult.inputCost).toBeCloseTo(0.75 * 0.001, 6);

      // Custom model should work
      const myResult = custom.estimate(1000, 'my-model');
      expect(myResult.inputCost).toBeCloseTo(0.75 * 0.001, 6);
      expect(myResult.outputCost).toBeCloseTo(0.25 * 0.002, 6);
    });

    it('should allow costOverrides on top of a custom models table', () => {
      const custom = new CostEstimator({
        models: {
          'base-model': { input: 0.001, output: 0.002 },
          'default': { input: 0.001, output: 0.002 },
        },
        costOverrides: {
          'override-model': { input: 0.01, output: 0.02 },
        },
      });

      const baseResult = custom.estimate(1000, 'base-model');
      expect(baseResult.inputCost).toBeCloseTo(0.75 * 0.001, 6);

      const overrideResult = custom.estimate(1000, 'override-model');
      expect(overrideResult.inputCost).toBeCloseTo(0.75 * 0.01, 6);
    });
  });

  describe('estimateWithCache', () => {
    it('should discount cached input tokens', () => {
      const result = estimator.estimateWithCache(10000, 2000, 5000, 'gpt-4o');
      expect(result.cachedInputTokens).toBe(5000);
      expect(result.cacheSavings).toBeGreaterThan(0);
      // Fresh: 5000 * 0.005/1K = 0.025
      // Cached: 5000 * 0.005/1K * 0.1 = 0.0025
      // Total input: 0.0275
      expect(result.inputCost).toBeCloseTo(0.0275, 4);
      expect(result.totalCost).toBeLessThan(
        estimator.estimateDetailed(10000, 2000, 'gpt-4o').totalCost,
      );
    });
  });
});
