import type {
  FlowConditionalNode,
  FlowDefinition,
  FlowGateNode,
  FlowLoopNode,
  FlowNode,
  FlowParallelNode,
  FlowSequenceNode,
  FlowStepNode,
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
