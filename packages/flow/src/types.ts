export type MaybePromise<T> = T | Promise<T>;

export type DataRef =
  | { kind: 'fromStep'; stepId: string; path?: string }
  | { kind: 'fromSteps'; stepIds: string[]; path?: string }
  | { kind: 'fromContext'; path?: string };

export type InputValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | DataRef
  | InputValue[]
  | { [key: string]: InputValue };

export interface FlowExecutionContext<TContext = Record<string, unknown>> {
  readonly flowId: string;
  readonly executionPath: readonly string[];
  readonly context: TContext;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly executionOutputs: Readonly<Record<string, unknown>>;
  getStepOutput<T = unknown>(stepId: string): T | undefined;
  getExecutionOutput<T = unknown>(executionId: string): T | undefined;
}

export interface FlowNodeBase<TContext = Record<string, unknown>> {
  id: string;
  dependsOn?: string[];
  input?: InputValue;
  checkpoint?: boolean;
  metadata?: Record<string, unknown>;
}

export interface FlowStepNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'step';
  run: (ctx: FlowExecutionContext<TContext>, input: unknown) => MaybePromise<unknown>;
}

export interface FlowGateNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'gate';
  evaluate: (ctx: FlowExecutionContext<TContext>, input: unknown) => MaybePromise<boolean>;
}

export interface FlowConditionalNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'conditional';
  when: (ctx: FlowExecutionContext<TContext>, input: unknown) => MaybePromise<boolean>;
  then: FlowNode<TContext>[];
  else?: FlowNode<TContext>[];
}

export interface FlowLoopNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'loop';
  do: FlowNode<TContext>[];
  maxIterations: number;
  while?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
  until?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
}

export interface FlowParallelNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'parallel';
  branches: Record<string, FlowNode<TContext>[]>;
  concurrency?: number;
}

export type FlowNode<TContext = Record<string, unknown>> =
  | FlowStepNode<TContext>
  | FlowGateNode<TContext>
  | FlowConditionalNode<TContext>
  | FlowLoopNode<TContext>
  | FlowParallelNode<TContext>;

export interface FlowDefinition<TContext = Record<string, unknown>> {
  id: string;
  description?: string;
  nodes: FlowNode<TContext>[];
}

export type FlowRunStatus = 'completed' | 'failed';

export interface FlowCheckpointSnapshot<TContext = Record<string, unknown>> {
  flowId: string;
  status: FlowRunStatus;
  startedAt: string;
  updatedAt: string;
  completedExecutionIds: string[];
  outputs: Record<string, unknown>;
  executionOutputs: Record<string, unknown>;
  context?: TContext;
  error?: string;
}

export interface FlowCheckpointAdapter<TContext = Record<string, unknown>> {
  load(flowId: string): MaybePromise<FlowCheckpointSnapshot<TContext> | null>;
  save(snapshot: FlowCheckpointSnapshot<TContext>): MaybePromise<void>;
}

export interface FlowRunnerOptions<TContext = Record<string, unknown>> {
  concurrency?: number;
  continueOnError?: boolean;
  checkpoint?: FlowCheckpointAdapter<TContext>;
}

export interface FlowRunResult<TContext = Record<string, unknown>> {
  flowId: string;
  status: FlowRunStatus;
  outputs: Record<string, unknown>;
  executionOutputs: Record<string, unknown>;
  context: TContext;
  startedAt: string;
  finishedAt: string;
  completedExecutionIds: string[];
  error?: FlowExecutionError;
}

export class FlowExecutionError extends Error {
  readonly flowId: string;
  readonly nodeId: string;
  readonly executionId: string;

  constructor(message: string, flowId: string, nodeId: string, executionId: string, cause?: unknown) {
    super(message);
    this.name = 'FlowExecutionError';
    this.flowId = flowId;
    this.nodeId = nodeId;
    this.executionId = executionId;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class FlowCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowCycleError';
  }
}
