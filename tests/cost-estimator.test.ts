import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostEstimator } from '../src/budget/cost-estimator.js';
import type { CadreConfig } from '../src/config/schema.js';

describe('CostEstimator', () => {
  let estimator: CostEstimator;

  beforeEach(() => {
    estimator = new CostEstimator({
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    } as CadreConfig['copilot']);
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

  describe('cost overrides', () => {
    it('should use overridden costs when provided', () => {
      const custom = new CostEstimator({
        cliCommand: 'copilot',
        agentDir: '.github/agents',
        timeout: 300000,
        costOverrides: {
          'custom-model': { input: 0.01, output: 0.02 },
        },
      } as CadreConfig['copilot']);

      const result = custom.estimate(1000, 'custom-model');
      // 750 input = 0.75 * 0.01 = $0.0075
      // 250 output = 0.25 * 0.02 = $0.005
      expect(result.inputCost).toBeCloseTo(0.0075, 4);
      expect(result.outputCost).toBeCloseTo(0.005, 4);
    });
  });
});
