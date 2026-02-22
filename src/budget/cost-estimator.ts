import type { CadreConfig } from '../config/schema.js';

/**
 * Default cost per 1K tokens for common models.
 * Values in USD.
 */
const DEFAULT_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'default': { input: 0.003, output: 0.015 },
};

/**
 * Estimates costs from token counts.
 */
export class CostEstimator {
  private readonly costs: Record<string, { input: number; output: number }>;

  constructor(config: CadreConfig['copilot']) {
    this.costs = { ...DEFAULT_COSTS };

    // Apply config overrides
    if (config.costOverrides) {
      for (const [model, cost] of Object.entries(config.costOverrides)) {
        this.costs[model] = cost;
      }
    }
  }

  /**
   * Estimate cost for a given number of tokens.
   * Assumes a 3:1 input-to-output ratio when not specified.
   */
  estimate(totalTokens: number, model?: string): CostEstimate {
    const cost = this.costs[model ?? 'default'] ?? this.costs['default'];
    const inputTokens = Math.round(totalTokens * 0.75);
    const outputTokens = totalTokens - inputTokens;

    const inputCost = (inputTokens / 1000) * cost.input;
    const outputCost = (outputTokens / 1000) * cost.output;

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      model: model ?? 'default',
    };
  }

  /**
   * Estimate cost with explicit input/output token counts.
   */
  estimateDetailed(
    inputTokens: number,
    outputTokens: number,
    model?: string,
  ): CostEstimate {
    const cost = this.costs[model ?? 'default'] ?? this.costs['default'];
    const inputCost = (inputTokens / 1000) * cost.input;
    const outputCost = (outputTokens / 1000) * cost.output;

    return {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      model: model ?? 'default',
    };
  }

  /**
   * Format a cost estimate as a human-readable string.
   */
  format(estimate: CostEstimate): string {
    return `$${estimate.totalCost.toFixed(4)} (${estimate.totalTokens.toLocaleString()} tokens)`;
  }
}

export interface CostEstimate {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
}
