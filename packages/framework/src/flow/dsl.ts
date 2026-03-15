import type {
  FlowCatchNode,
  FlowConditionalNode,
  FlowDefinition,
  FlowExecutionContext,
  FlowGateNode,
  FlowLoopNode,
  FlowMapNode,
  FlowNode,
  FlowParallelNode,
  FlowSequenceNode,
  FlowStepNode,
  FlowSubflowNode,
  MaybePromise,
} from './types.js';

export function defineFlow<TContext = Record<string, unknown>>(
  id: string,
  nodes: FlowNode<TContext>[],
  description?: string,
): FlowDefinition<TContext> {
  return { id, nodes, description };
}

export function step<TContext = Record<string, unknown>, TInput = unknown, TOutput = unknown>(
  config: Omit<FlowStepNode<TContext, TInput, TOutput>, 'kind'>,
): FlowStepNode<TContext, TInput, TOutput> {
  return { kind: 'step', ...config };
}

export function gate<TContext = Record<string, unknown>, TInput = unknown>(
  config: Omit<FlowGateNode<TContext, TInput>, 'kind'>,
): FlowGateNode<TContext, TInput> {
  return { kind: 'gate', ...config };
}

export function conditional<TContext = Record<string, unknown>, TInput = unknown>(
  config: Omit<FlowConditionalNode<TContext, TInput>, 'kind'>,
): FlowConditionalNode<TContext, TInput> {
  return { kind: 'conditional', ...config };
}

export function loop<TContext = Record<string, unknown>>(
  config: Omit<FlowLoopNode<TContext>, 'kind'>,
): FlowLoopNode<TContext> {
  return { kind: 'loop', ...config };
}

export function parallel<TContext = Record<string, unknown>>(
  config: Omit<FlowParallelNode<TContext>, 'kind'>,
): FlowParallelNode<TContext> {
  return { kind: 'parallel', ...config };
}

/**
 * Create a sequence of nodes that auto-wire `dependsOn` to the previous sibling.
 *
 * The first node in the sequence inherits `dependsOn` from the sequence config.
 * Subsequent nodes automatically depend on the previous sibling's id.
 * The outer sequence node itself is transparent to FlowRunner — it expands
 * into the inner nodes with correct wiring.
 */
export function sequence<TContext = Record<string, unknown>>(
  config: { id: string; name?: string; description?: string; dependsOn?: string[] },
  nodes: FlowNode<TContext>[],
): FlowSequenceNode<TContext> {
  return { kind: 'sequence', ...config, nodes };
}

/**
 * Create a map node that runs a function over each item in a collection.
 *
 * The input must resolve to an array. The `do` function is invoked for each
 * item (up to `concurrency` in parallel). The node output is the collected
 * array of results.
 */
export function map<TContext = Record<string, unknown>, TInput = unknown, TItemOutput = unknown>(
  config: Omit<FlowMapNode<TContext, TInput, TItemOutput>, 'kind'>,
): FlowMapNode<TContext, TInput, TItemOutput> {
  return { kind: 'map', ...config };
}

/**
 * Create a catch node for error handling.
 *
 * Wraps a list of nodes in a try/catch/finally construct. If any node in `try`
 * throws, the `catch` handler is called with the error. Optional `finally`
 * nodes execute regardless of outcome.
 */
export function catchError<TContext = Record<string, unknown>>(
  config: Omit<FlowCatchNode<TContext>, 'kind'>,
): FlowCatchNode<TContext> {
  return { kind: 'catch', ...config };
}

/**
 * Create a subflow node that delegates to a child FlowDefinition.
 *
 * The child flow runs as a nested execution under the parent. Outputs from
 * the child flow are returned as the node's output. The `contextMap` function
 * bridges the parent context to the child context.
 *
 * @example
 * ```ts
 * subflow({
 *   id: 'nested-analysis',
 *   flow: analysisFlow,
 *   contextMap: (ctx) => ({ payload: ctx.context.payload }),
 *   dependsOn: ['previous-step'],
 * })
 * ```
 */
export function subflow<TContext = Record<string, unknown>, TChildContext = Record<string, unknown>>(
  config: Omit<FlowSubflowNode<TContext, TChildContext>, 'kind'>,
): FlowSubflowNode<TContext, TChildContext> {
  return { kind: 'subflow', ...config };
}

/**
 * Configuration for a gated step — execute with gate validation and retry.
 */
export interface GatedStepConfig<TContext = Record<string, unknown>> {
  id: string;
  name?: string;
  description?: string;
  dependsOn?: string[];
  /** Maximum number of gate-retry attempts (not counting the initial run). */
  maxRetries: number;
  /** Called before each iteration; return false to skip (e.g. checkpoint resume). */
  shouldExecute: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
  /** Called when the loop runs 0 iterations (shouldExecute returned false). */
  onSkip?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<unknown>;
  /** The work to execute.  Called each attempt (initial + retries). */
  run: (ctx: FlowExecutionContext<TContext>) => MaybePromise<unknown>;
  /** Gate validation.  Return true to pass, false to retry or abort. */
  evaluate: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
}

/**
 * Convenience combinator: execute a step with gate validation and retry.
 *
 * Expands to `sequence([ loop(step + gate) ])`.  The loop's `while` guard
 * is `shouldExecute`; inner nodes are `run` (step) and `evaluate` (gate).
 * No new node kind is introduced — this is syntactic sugar over existing
 * primitives.
 *
 * @example
 * ```ts
 * gatedStep({
 *   id: 'analysis',
 *   name: 'Analysis & Scouting',
 *   maxRetries: 2,
 *   shouldExecute: (ctx) => !ctx.context.completed['analysis'],
 *   run: (ctx) => runAnalysis(ctx),
 *   evaluate: (ctx) => validateAnalysisGate(ctx),
 * })
 * ```
 */
export function gatedStep<TContext = Record<string, unknown>>(
  config: GatedStepConfig<TContext>,
): FlowSequenceNode<TContext> {
  const loopId = `${config.id}-execute-with-gate`;
  const runId = `${config.id}-run`;
  const gateId = `${config.id}-gate`;
  return sequence<TContext>(
    { id: config.id, name: config.name, description: config.description, dependsOn: config.dependsOn },
    [
      {
        kind: 'loop',
        id: loopId,
        name: config.name ? `Execute ${config.name} with gate retries` : 'Execute with gate retries',
        maxIterations: config.maxRetries + 1,
        while: config.shouldExecute,
        onSkip: config.onSkip,
        do: [
          { kind: 'step', id: runId, name: config.name ? `Run ${config.name}` : 'Run', run: config.run },
          { kind: 'gate', id: gateId, name: config.name ? `Validate ${config.name} gate` : 'Validate gate', evaluate: config.evaluate },
        ],
      } as FlowLoopNode<TContext>,
    ],
  );
}
