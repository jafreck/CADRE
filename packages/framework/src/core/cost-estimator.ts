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

/** Cache hits are discounted by 90% for both Claude and GPT-4o. */
const DEFAULT_CACHE_DISCOUNT = 0.9;

export interface CostEstimatorConfig {
  /**
   * Complete model pricing table. When provided, replaces the built-in
   * defaults entirely (caller owns the full table).
   * Should include a 'default' entry as fallback.
   */
  models?: Record<string, { input: number; output: number }>;
  /** Merge-style overrides applied on top of the base table (built-in or `models`). */
  costOverrides?: Record<string, { input: number; output: number }>;
  /** Default input/output token split ratio when only total tokens are known. Defaults to 0.75. */
  defaultInputRatio?: number;
  /** Discount multiplier for cached input tokens (0-1). Defaults to 0.9 (90% off). */
  cacheDiscount?: number;
}

export interface CostEstimate {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  inputCost: number;
  outputCost: number;
  cacheSavings?: number;
  totalCost: number;
  model: string;
}

export class CostEstimator {
  private readonly costs: Record<string, { input: number; output: number }>;
  private readonly inputRatio: number;
  private readonly cacheDiscount: number;

  constructor(config: CostEstimatorConfig = {}) {
    // If `models` is provided, use it as the base; otherwise use built-in defaults.
    this.costs = config.models ? { ...config.models } : { ...DEFAULT_COSTS };
    this.inputRatio = config.defaultInputRatio ?? 0.75;
    this.cacheDiscount = config.cacheDiscount ?? DEFAULT_CACHE_DISCOUNT;

    if (config.costOverrides) {
      for (const [model, cost] of Object.entries(config.costOverrides)) {
        this.costs[model] = cost;
      }
    }
  }

  estimate(totalTokens: number, model?: string): CostEstimate {
    const cost = this.costs[model ?? 'default'] ?? this.costs['default'];
    const inputTokens = Math.round(totalTokens * this.inputRatio);
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
   * Estimate cost with cached input token awareness.
   * Cached tokens are discounted (default 90% off) to avoid overestimating costs.
   */
  estimateWithCache(
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    model?: string,
  ): CostEstimate {
    const cost = this.costs[model ?? 'default'] ?? this.costs['default'];
    const freshInputTokens = inputTokens - cachedInputTokens;
    const freshInputCost = (freshInputTokens / 1000) * cost.input;
    const cachedInputCost = (cachedInputTokens / 1000) * cost.input * (1 - this.cacheDiscount);
    const inputCost = freshInputCost + cachedInputCost;
    const outputCost = (outputTokens / 1000) * cost.output;
    const fullPriceInputCost = (inputTokens / 1000) * cost.input;
    const cacheSavings = fullPriceInputCost - inputCost;

    return {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      inputCost,
      outputCost,
      cacheSavings,
      totalCost: inputCost + outputCost,
      model: model ?? 'default',
    };
  }

  estimateIssueTokens(historicalAvgTokens?: number): number {
    const DEFAULT_ISSUE_TOKENS = 200_000;
    return historicalAvgTokens ?? DEFAULT_ISSUE_TOKENS;
  }

  format(estimate: CostEstimate): string {
    return `$${estimate.totalCost.toFixed(4)} (${estimate.totalTokens.toLocaleString()} tokens)`;
  }
}
