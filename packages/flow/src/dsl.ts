import type {
  FlowConditionalNode,
  FlowDefinition,
  FlowGateNode,
  FlowLoopNode,
  FlowNode,
  FlowParallelNode,
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
