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

export function step<TContext = Record<string, unknown>>(
  config: Omit<FlowStepNode<TContext>, 'kind'>,
): FlowStepNode<TContext> {
  return { kind: 'step', ...config };
}

export function gate<TContext = Record<string, unknown>>(
  config: Omit<FlowGateNode<TContext>, 'kind'>,
): FlowGateNode<TContext> {
  return { kind: 'gate', ...config };
}

export function conditional<TContext = Record<string, unknown>>(
  config: Omit<FlowConditionalNode<TContext>, 'kind'>,
): FlowConditionalNode<TContext> {
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
