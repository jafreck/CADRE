/**
 * Model routing — per-task model selection with pluggable strategy.
 *
 * Supports two task modes:
 * - `deterministic`: Structured output, classification, extraction — favors
 *   smaller/cheaper models that follow instructions precisely.
 * - `agentic`: Multi-step reasoning, code generation, planning — favors
 *   larger/more capable models.
 *
 * The `ModelRouter` delegates to a `ModelStrategy` for the actual selection
 * logic. A default tier-based strategy is provided, but consumers can plug
 * in their own (e.g., cost-aware, latency-aware, A/B testing).
 */

/** Task mode distinguishing structured/deterministic work from agentic reasoning. */
export type TaskMode = 'deterministic' | 'agentic';

/** Complexity tier for model selection. */
export type ComplexityTier = 'low' | 'medium' | 'high';

export interface ModelSelectionRequest {
  /** Task complexity. */
  complexity: ComplexityTier;
  /** Whether the task is deterministic (structured output) or agentic (reasoning). */
  mode: TaskMode;
  /** Optional capability requirements (e.g., 'tool-use', 'vision', 'long-context'). */
  capabilities?: string[];
  /** Optional budget cap in USD for this invocation. */
  budgetCap?: number;
}

export interface ModelSelection {
  model: string;
  /** Reason this model was selected. */
  reason: string;
}

/**
 * Pluggable strategy interface for model selection.
 * Implement this to customize model routing logic.
 */
export interface ModelStrategy {
  select(request: ModelSelectionRequest): ModelSelection;
}

/** Configuration for the default tier-based strategy. */
export interface TierStrategyConfig {
  /** Models for deterministic tasks, keyed by complexity. */
  deterministic?: Partial<Record<ComplexityTier, string>>;
  /** Models for agentic tasks, keyed by complexity. */
  agentic?: Partial<Record<ComplexityTier, string>>;
}

const DEFAULT_TIERS: Required<Pick<TierStrategyConfig, 'deterministic' | 'agentic'>> = {
  deterministic: {
    low: 'gpt-4o-mini',
    medium: 'gpt-4o-mini',
    high: 'gpt-4o',
  },
  agentic: {
    low: 'claude-sonnet-4-20250514',
    medium: 'claude-sonnet-4-20250514',
    high: 'claude-opus-4-20250514',
  },
};

/**
 * Default model strategy based on complexity tiers and task mode.
 * Deterministic tasks route to smaller models; agentic tasks route to
 * more capable models. Each tier can be overridden via config.
 */
export class TierModelStrategy implements ModelStrategy {
  private readonly tiers: Required<Pick<TierStrategyConfig, 'deterministic' | 'agentic'>>;

  constructor(config: TierStrategyConfig = {}) {
    this.tiers = {
      deterministic: { ...DEFAULT_TIERS.deterministic, ...config.deterministic },
      agentic: { ...DEFAULT_TIERS.agentic, ...config.agentic },
    };
  }

  select(request: ModelSelectionRequest): ModelSelection {
    const tierMap = this.tiers[request.mode];
    const model = tierMap[request.complexity] ?? tierMap['medium']!;
    return {
      model,
      reason: `${request.mode}/${request.complexity} → ${model}`,
    };
  }
}

/**
 * Model router that delegates to a pluggable strategy.
 *
 * Usage:
 * ```ts
 * const router = new ModelRouter();
 * const { model } = router.selectModel({ complexity: 'high', mode: 'agentic' });
 * const { model: cheapModel } = router.selectModel({ complexity: 'low', mode: 'deterministic' });
 * ```
 */
export class ModelRouter {
  private strategy: ModelStrategy;

  constructor(strategy?: ModelStrategy) {
    this.strategy = strategy ?? new TierModelStrategy();
  }

  /** Replace the active strategy. */
  setStrategy(strategy: ModelStrategy): void {
    this.strategy = strategy;
  }

  /** Select a model for the given request. */
  selectModel(request: ModelSelectionRequest): ModelSelection {
    return this.strategy.select(request);
  }
}

/**
 * Convenience function — creates a one-shot model selection without
 * instantiating a router. Uses the default tier strategy.
 */
export function selectModel(
  complexity: ComplexityTier,
  mode: TaskMode = 'agentic',
  capabilities?: string[],
): ModelSelection {
  const router = new ModelRouter();
  return router.selectModel({ complexity, mode, capabilities });
}
