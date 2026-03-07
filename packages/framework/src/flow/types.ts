import type { ZodType } from 'zod';

export type MaybePromise<T> = T | Promise<T>;

export type DataRef<TValue = unknown> =
  | ({ kind: 'fromStep'; stepId: string; path?: string } & { readonly __valueType?: TValue })
  | ({ kind: 'fromSteps'; stepIds: readonly string[]; path?: string } & { readonly __valueType?: TValue })
  | ({ kind: 'fromContext'; path?: string } & { readonly __valueType?: TValue });

export type InputValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | DataRef
  | InputValue[]
  | { [key: string]: InputValue };

export type RoutedInput<T> = unknown extends T
  ? InputValue
  : T extends string | number | boolean | null | undefined
    ? T | DataRef<T>
    : T extends Array<infer TEntry>
      ? Array<RoutedInput<TEntry>> | DataRef<T>
      : T extends object
        ? { [K in keyof T]: RoutedInput<T[K]> } | DataRef<T>
        : T | DataRef<T>;

export interface StepContract<TInput = unknown, TOutput = unknown> {
  inputSchema?: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
}

export type FlowContracts = Record<string, StepContract<unknown, unknown>>;

export interface FlowContractIssue {
  fromStep: string;
  toStep: string;
  fieldPath: string;
  reason: string;
}

export interface FlowContractValidationResult {
  valid: boolean;
  issues: FlowContractIssue[];
}

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
  /** Human-readable label for visualization and logging. */
  name?: string;
  /** Longer description of what this node does. */
  description?: string;
  dependsOn?: string[];
  input?: unknown;
  checkpoint?: boolean;
  metadata?: Record<string, unknown>;
  /** Per-node timeout in milliseconds. When exceeded, the node is aborted and treated as failed. */
  timeoutMs?: number;
  /** Per-node retry configuration. When set, the node is retried on failure. */
  retry?: {
    /** Maximum number of retry attempts (not counting the initial run). */
    maxAttempts: number;
    /** Backoff strategy between retries. Defaults to 'fixed'. */
    backoff?: 'fixed' | 'linear' | 'exponential';
    /** Base delay in milliseconds between retries. Defaults to 1000. */
    delayMs?: number;
  };
}

export interface FlowStepNode<TContext = Record<string, unknown>, TInput = unknown, TOutput = unknown>
  extends FlowNodeBase<TContext> {
  kind: 'step';
  input?: RoutedInput<TInput>;
  inputSchema?: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
  run: (ctx: FlowExecutionContext<TContext>, input: TInput) => MaybePromise<TOutput>;
}

export interface FlowGateNode<TContext = Record<string, unknown>, TInput = unknown> extends FlowNodeBase<TContext> {
  kind: 'gate';
  input?: RoutedInput<TInput>;
  inputSchema?: ZodType<TInput>;
  evaluate: (ctx: FlowExecutionContext<TContext>, input: TInput) => MaybePromise<boolean>;
}

export interface FlowConditionalNode<TContext = Record<string, unknown>, TInput = unknown> extends FlowNodeBase<TContext> {
  kind: 'conditional';
  input?: RoutedInput<TInput>;
  inputSchema?: ZodType<TInput>;
  when: (ctx: FlowExecutionContext<TContext>, input: TInput) => MaybePromise<boolean>;
  then: FlowNode<TContext>[];
  else?: FlowNode<TContext>[];
}

export interface FlowLoopNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'loop';
  do: FlowNode<TContext>[];
  maxIterations: number;
  while?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
  until?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<boolean>;
  /** Called when the loop runs 0 iterations (e.g. `while` returns false immediately). */
  onSkip?: (ctx: FlowExecutionContext<TContext>) => MaybePromise<unknown>;
}

export interface FlowParallelNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'parallel';
  branches: Record<string, FlowNode<TContext>[]>;
  concurrency?: number;
}

export interface FlowSequenceNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'sequence';
  nodes: FlowNode<TContext>[];
}

export interface FlowMapNode<TContext = Record<string, unknown>, TInput = unknown, TItemOutput = unknown>
  extends FlowNodeBase<TContext> {
  kind: 'map';
  /** Input that resolves to an iterable collection. */
  input?: RoutedInput<TInput[]>;
  inputSchema?: ZodType<TInput[]>;
  outputSchema?: ZodType<TItemOutput[]>;
  /** Maximum concurrent items. Defaults to unbounded. */
  concurrency?: number;
  /** Execute this step for each item in the input collection. */
  do: (ctx: FlowExecutionContext<TContext>, item: TInput, index: number) => MaybePromise<TItemOutput>;
}

export interface FlowCatchNode<TContext = Record<string, unknown>> extends FlowNodeBase<TContext> {
  kind: 'catch';
  /** The nodes to execute inside the try block. */
  try: FlowNode<TContext>[];
  /** Called when any node in `try` throws. Return value becomes the catch node's output. */
  catch: (ctx: FlowExecutionContext<TContext>, error: Error) => MaybePromise<unknown>;
  /** Optional nodes to execute after try/catch regardless of outcome. */
  finally?: FlowNode<TContext>[];
}

export type FlowNode<TContext = Record<string, unknown>> =
  | FlowStepNode<TContext>
  | FlowGateNode<TContext>
  | FlowConditionalNode<TContext>
  | FlowLoopNode<TContext>
  | FlowParallelNode<TContext>
  | FlowSequenceNode<TContext>
  | FlowMapNode<TContext>
  | FlowCatchNode<TContext>;

export interface FlowDefinition<TContext = Record<string, unknown>> {
  id: string;
  description?: string;
  nodes: FlowNode<TContext>[];
  contracts?: FlowContracts;
}

export type FlowRunStatus = 'completed' | 'failed' | 'running' | 'cancelled' | 'timed-out';

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

/** Lifecycle hooks called by FlowRunner during execution. */
export interface FlowLifecycleHooks<TContext = Record<string, unknown>> {
  /** Called before a node starts executing. */
  onNodeStart?: (nodeId: string, node: FlowNode<TContext>) => MaybePromise<void>;
  /** Called after a node completes successfully. */
  onNodeComplete?: (nodeId: string, node: FlowNode<TContext>, output: unknown) => MaybePromise<void>;
  /** Called when a node is skipped (checkpoint resume or loop skip). */
  onNodeSkip?: (nodeId: string, node: FlowNode<TContext>) => MaybePromise<void>;
  /**
   * Called when a node is skipped because one or more of its `dependsOn`
   * targets failed (or were themselves upstream-failed).  Requires
   * `continueOnError: true`.  The return value, if any, is stored as the
   * node's output.  The node is then marked as failed so that its own
   * dependents also receive this callback.
   */
  onUpstreamFailure?: (nodeId: string, node: FlowNode<TContext>, failedDeps: string[]) => MaybePromise<unknown>;
}

export interface FlowRunnerOptions<TContext = Record<string, unknown>> {
  concurrency?: number;
  continueOnError?: boolean;
  /**
   * When `true`, nodes whose `dependsOn` constraints are satisfied are
   * executed concurrently (up to `concurrency`).  When `false` (default),
   * nodes execute sequentially in declaration order — which is required
   * when data routing relies on implicit ordering rather than explicit
   * `dependsOn` edges.
   */
  concurrentNodes?: boolean;
  checkpoint?: FlowCheckpointAdapter<TContext>;
  contracts?: FlowContracts;
  hooks?: FlowLifecycleHooks<TContext>;
  /** Flow-level timeout in milliseconds. When exceeded the run is aborted with status 'timed-out'. */
  timeoutMs?: number;
  /** AbortSignal for external cancellation. When aborted, the run completes with status 'cancelled'. */
  signal?: AbortSignal;
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

export class FlowContractError extends FlowExecutionError {
  readonly fromStep: string;
  readonly toStep: string;
  readonly fieldPath: string;
  readonly reason: string;

  constructor(
    flowId: string,
    toStep: string,
    executionId: string,
    fromStep: string,
    fieldPath: string,
    reason: string,
    cause?: unknown,
  ) {
    super(
      `Contract mismatch from '${fromStep}' to '${toStep}' at '${fieldPath}': ${reason}`,
      flowId,
      toStep,
      executionId,
      cause,
    );
    this.name = 'FlowContractError';
    this.fromStep = fromStep;
    this.toStep = toStep;
    this.fieldPath = fieldPath;
    this.reason = reason;
  }
}
