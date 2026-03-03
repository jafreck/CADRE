import pLimit from 'p-limit';
import {
  FlowCycleError,
  FlowExecutionError,
  type DataRef,
  type FlowCheckpointSnapshot,
  type FlowDefinition,
  type FlowExecutionContext,
  type FlowNode,
  type FlowRunResult,
  type FlowRunnerOptions,
  type InputValue,
} from './types.js';

interface RunnerState<TContext> {
  flow: FlowDefinition<TContext>;
  context: TContext;
  outputs: Record<string, unknown>;
  executionOutputs: Record<string, unknown>;
  completedExecutionIds: Set<string>;
  hadError: boolean;
  lastError?: FlowExecutionError;
  startedAt: string;
  options: Required<Pick<FlowRunnerOptions<TContext>, 'concurrency' | 'continueOnError'>> & Pick<FlowRunnerOptions<TContext>, 'checkpoint'>;
}

export class FlowRunner<TContext = Record<string, unknown>> {
  constructor(private readonly defaults: FlowRunnerOptions<TContext> = {}) {}

  async run(flow: FlowDefinition<TContext>, context: TContext, options: FlowRunnerOptions<TContext> = {}): Promise<FlowRunResult<TContext>> {
    const merged: RunnerState<TContext>['options'] = {
      concurrency: options.concurrency ?? this.defaults.concurrency ?? Number.POSITIVE_INFINITY,
      continueOnError: options.continueOnError ?? this.defaults.continueOnError ?? false,
      checkpoint: options.checkpoint ?? this.defaults.checkpoint,
    };

    const startedAt = new Date().toISOString();
    const state: RunnerState<TContext> = {
      flow,
      context,
      outputs: {},
      executionOutputs: {},
      completedExecutionIds: new Set(),
      hadError: false,
      startedAt,
      options: merged,
    };

    await this.loadCheckpoint(state);

    try {
      await this.executeNodeList(state, flow.nodes, [flow.id]);
      const finishedAt = new Date().toISOString();
      const status = state.hadError ? 'failed' : 'completed';
      await this.persistCheckpoint(state, status, state.lastError?.message);
      return {
        flowId: flow.id,
        status,
        outputs: { ...state.outputs },
        executionOutputs: { ...state.executionOutputs },
        context: state.context,
        startedAt: state.startedAt,
        finishedAt,
        completedExecutionIds: [...state.completedExecutionIds],
        error: state.lastError,
      };
    } catch (error) {
      const wrapped = this.wrapError(flow.id, 'flow', flow.id, error);
      await this.persistCheckpoint(state, 'failed', wrapped.message);
      if (!merged.continueOnError) {
        throw wrapped;
      }
      return {
        flowId: flow.id,
        status: 'failed',
        outputs: { ...state.outputs },
        executionOutputs: { ...state.executionOutputs },
        context: state.context,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        completedExecutionIds: [...state.completedExecutionIds],
        error: wrapped,
      };
    }
  }

  private async loadCheckpoint(state: RunnerState<TContext>): Promise<void> {
    if (!state.options.checkpoint) return;
    const snapshot = await state.options.checkpoint.load(state.flow.id);
    if (!snapshot) return;
    state.outputs = { ...snapshot.outputs };
    state.executionOutputs = { ...snapshot.executionOutputs };
    for (const executionId of snapshot.completedExecutionIds) {
      state.completedExecutionIds.add(executionId);
    }
  }

  private async persistCheckpoint(
    state: RunnerState<TContext>,
    status: 'completed' | 'failed',
    error?: string,
  ): Promise<void> {
    if (!state.options.checkpoint) return;
    const snapshot: FlowCheckpointSnapshot<TContext> = {
      flowId: state.flow.id,
      status,
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString(),
      completedExecutionIds: [...state.completedExecutionIds],
      outputs: { ...state.outputs },
      executionOutputs: { ...state.executionOutputs },
      context: state.context,
      error,
    };
    await state.options.checkpoint.save(snapshot);
  }

  private buildExecutionContext(state: RunnerState<TContext>, executionPath: string[]): FlowExecutionContext<TContext> {
    return {
      flowId: state.flow.id,
      executionPath,
      context: state.context,
      outputs: state.outputs,
      executionOutputs: state.executionOutputs,
      getStepOutput: <T = unknown>(stepId: string): T | undefined => state.outputs[stepId] as T | undefined,
      getExecutionOutput: <T = unknown>(executionId: string): T | undefined => state.executionOutputs[executionId] as T | undefined,
    };
  }

  private async executeNodeList(
    state: RunnerState<TContext>,
    nodes: FlowNode<TContext>[],
    executionPath: string[],
  ): Promise<Record<string, unknown>> {
    this.validateNodeIds(nodes, executionPath.join('/'));

    const pending = [...nodes];
    const localResolved = new Set<string>();
    const localOutputs: Record<string, unknown> = {};

    while (pending.length > 0) {
      const ready = pending.filter((node) => (node.dependsOn ?? []).every((dependency) => localResolved.has(dependency)));

      if (ready.length === 0) {
        const unresolved = pending.map((node) => node.id).join(', ');
        throw new FlowCycleError(`No executable nodes remain in scope ${executionPath.join('/')} (pending: ${unresolved})`);
      }

      for (const node of ready) {
        const executionId = `${executionPath.join('/')}/${node.id}`;
        if (state.completedExecutionIds.has(executionId)) {
          localResolved.add(node.id);
          localOutputs[node.id] = state.executionOutputs[executionId];
          const index = pending.findIndex((candidate) => candidate.id === node.id);
          pending.splice(index, 1);
          continue;
        }

        try {
          const output = await this.executeNode(state, node, [...executionPath, node.id], executionId);
          state.outputs[node.id] = output;
          state.executionOutputs[executionId] = output;
          state.completedExecutionIds.add(executionId);
          localOutputs[node.id] = output;
          localResolved.add(node.id);
          await this.persistCheckpoint(state, 'completed');
        } catch (error) {
          const wrapped = this.wrapError(state.flow.id, node.id, executionId, error);
          state.hadError = true;
          state.lastError = wrapped;
          localResolved.add(node.id);
          if (!state.options.continueOnError) {
            throw wrapped;
          }
        }

        const index = pending.findIndex((candidate) => candidate.id === node.id);
        pending.splice(index, 1);
      }
    }

    return localOutputs;
  }

  private async executeNode(
    state: RunnerState<TContext>,
    node: FlowNode<TContext>,
    executionPath: string[],
    executionId: string,
  ): Promise<unknown> {
    const context = this.buildExecutionContext(state, executionPath);
    const resolvedInput = this.resolveInput(node.input, context);

    switch (node.kind) {
      case 'step': {
        return node.run(context, resolvedInput);
      }
      case 'gate': {
        const passed = await node.evaluate(context, resolvedInput);
        if (!passed) {
          throw new Error(`Gate ${node.id} failed`);
        }
        return { passed: true };
      }
      case 'conditional': {
        const matches = await node.when(context, resolvedInput);
        const branch = matches ? node.then : (node.else ?? []);
        const branchKey = matches ? 'then' : 'else';
        const branchOutputs = await this.executeNodeList(state, branch, [...executionPath, branchKey]);
        return { branch: branchKey, outputs: branchOutputs };
      }
      case 'loop': {
        const outputs: unknown[] = [];
        let iterations = 0;

        while (iterations < node.maxIterations) {
          const loopCtx = this.buildExecutionContext(state, [...executionPath, `iteration-${iterations + 1}`]);
          if (node.while) {
            const shouldContinue = await node.while(loopCtx);
            if (!shouldContinue) break;
          }

          const iterationOutputs = await this.executeNodeList(
            state,
            node.do,
            [...executionPath, `iteration-${iterations + 1}`],
          );
          outputs.push(iterationOutputs);
          iterations += 1;

          if (node.until) {
            const done = await node.until(this.buildExecutionContext(state, [...executionPath, `iteration-${iterations}`]));
            if (done) {
              break;
            }
          }
        }

        return { iterations, outputs };
      }
      case 'parallel': {
        const entries = Object.entries(node.branches);
        const branchResults: Record<string, unknown> = {};
        const limit = pLimit(Math.max(1, Math.floor(node.concurrency ?? state.options.concurrency)));

        await Promise.all(
          entries.map(([branchId, branchNodes]) =>
            limit(async () => {
              const result = await this.executeNodeList(state, branchNodes, [...executionPath, branchId]);
              branchResults[branchId] = result;
            }),
          ),
        );

        return branchResults;
      }
      default: {
        const exhaustive: never = node;
        throw new Error(`Unsupported node kind ${(exhaustive as { kind?: string }).kind ?? 'unknown'}`);
      }
    }
  }

  private resolveInput(value: InputValue | undefined, context: FlowExecutionContext<TContext>): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.resolveInput(entry, context));
    }

    if (this.isDataRef(value)) {
      return this.resolveDataRef(value, context);
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = this.resolveInput(entry as InputValue, context);
    }
    return out;
  }

  private resolveDataRef(ref: DataRef, context: FlowExecutionContext<TContext>): unknown {
    switch (ref.kind) {
      case 'fromStep': {
        return this.getAtPath(context.getStepOutput(ref.stepId), ref.path);
      }
      case 'fromSteps': {
        const out: Record<string, unknown> = {};
        for (const stepId of ref.stepIds) {
          out[stepId] = this.getAtPath(context.getStepOutput(stepId), ref.path);
        }
        return out;
      }
      case 'fromContext': {
        const source = context.context as unknown;
        return this.getAtPath(source, ref.path);
      }
      default: {
        const exhaustive: never = ref;
        throw new Error(`Unsupported data ref ${(exhaustive as { kind?: string }).kind ?? 'unknown'}`);
      }
    }
  }

  private getAtPath(source: unknown, path?: string): unknown {
    if (!path || path.trim().length === 0) {
      return source;
    }

    const parts = path.split('.').filter(Boolean);
    let cursor: unknown = source;
    for (const part of parts) {
      if (cursor === null || cursor === undefined) {
        return undefined;
      }
      if (Array.isArray(cursor)) {
        const index = Number(part);
        cursor = Number.isNaN(index) ? undefined : cursor[index];
      } else if (typeof cursor === 'object') {
        cursor = (cursor as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return cursor;
  }

  private isDataRef(value: unknown): value is DataRef {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as { kind?: string };
    return candidate.kind === 'fromStep' || candidate.kind === 'fromSteps' || candidate.kind === 'fromContext';
  }

  private validateNodeIds(nodes: FlowNode<TContext>[], scope: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (seen.has(node.id)) {
        throw new Error(`Duplicate node id '${node.id}' in scope ${scope}`);
      }
      seen.add(node.id);
    }
  }

  private wrapError(flowId: string, nodeId: string, executionId: string, error: unknown): FlowExecutionError {
    if (error instanceof FlowExecutionError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new FlowExecutionError(message, flowId, nodeId, executionId, error);
  }
}
