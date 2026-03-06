import pLimit from 'p-limit';
import { getContractForStep, mergeContracts, schemaAtPath, validateFlowContracts, type IndexedFlow } from './contracts.js';
import {
  FlowContractError,
  FlowCycleError,
  FlowExecutionError,
  type DataRef,
  type FlowCheckpointSnapshot,
  type FlowContracts,
  type FlowDefinition,
  type FlowExecutionContext,
  type FlowNode,
  type FlowRunResult,
  type FlowRunnerOptions,
} from './types.js';

interface RunnerState<TContext> {
  flow: FlowDefinition<TContext>;
  indexedNodes: Map<string, FlowNode<TContext>>;
  contracts: FlowContracts;
  context: TContext;
  outputs: Record<string, unknown>;
  executionOutputs: Record<string, unknown>;
  completedExecutionIds: Set<string>;
  hadError: boolean;
  lastError?: FlowExecutionError;
  startedAt: string;
  options: Required<Pick<FlowRunnerOptions<TContext>, 'concurrency' | 'continueOnError'>> & Pick<FlowRunnerOptions<TContext>, 'checkpoint' | 'hooks'>;
}

export class FlowRunner<TContext = Record<string, unknown>> {
  constructor(private readonly defaults: FlowRunnerOptions<TContext> = {}) {}

  async run(flow: FlowDefinition<TContext>, context: TContext, options: FlowRunnerOptions<TContext> = {}): Promise<FlowRunResult<TContext>> {
    const merged: RunnerState<TContext>['options'] = {
      concurrency: options.concurrency ?? this.defaults.concurrency ?? Number.POSITIVE_INFINITY,
      continueOnError: options.continueOnError ?? this.defaults.continueOnError ?? false,
      checkpoint: options.checkpoint ?? this.defaults.checkpoint,
      hooks: options.hooks ?? this.defaults.hooks,
    };

    const startedAt = new Date().toISOString();
    const state: RunnerState<TContext> = {
      flow,
      indexedNodes: this.indexNodes(flow.nodes),
      contracts: mergeContracts(flow.contracts, options.contracts ?? this.defaults.contracts),
      context,
      outputs: {},
      executionOutputs: {},
      completedExecutionIds: new Set(),
      hadError: false,
      startedAt,
      options: merged,
    };

    await this.loadCheckpoint(state);

    if (Object.keys(state.contracts).length > 0) {
      const validation = validateFlowContracts(flow, state.contracts);
      if (!validation.valid) {
        const first = validation.issues[0];
        throw new FlowContractError(
          flow.id,
          first.toStep,
          `${flow.id}/${first.toStep}`,
          first.fromStep,
          first.fieldPath,
          first.reason,
        );
      }
    }

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
          await state.options.hooks?.onNodeSkip?.(node.id, node);
          localResolved.add(node.id);
          localOutputs[node.id] = state.executionOutputs[executionId];
          const index = pending.findIndex((candidate) => candidate.id === node.id);
          pending.splice(index, 1);
          continue;
        }

        try {
          await state.options.hooks?.onNodeStart?.(node.id, node);
          const output = await this.executeNode(state, node, [...executionPath, node.id], executionId);
          state.outputs[node.id] = output;
          state.executionOutputs[executionId] = output;
          state.completedExecutionIds.add(executionId);
          localOutputs[node.id] = output;
          localResolved.add(node.id);
          await state.options.hooks?.onNodeComplete?.(node.id, node, output);
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
    const resolvedInput = this.resolveInput(state, node.input, context, node.id, executionId, 'input');
    this.validateConsumerInput(state, node.id, executionId, resolvedInput, 'input', 'flow-input');

    switch (node.kind) {
      case 'step': {
        const output = await node.run(context, resolvedInput);
        this.validateProducerOutput(state, node.id, executionId, output);
        return output;
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

        // Fire onSkip when the loop ran 0 iterations
        if (iterations === 0 && node.onSkip) {
          const skipCtx = this.buildExecutionContext(state, executionPath);
          const skipOutput = await node.onSkip(skipCtx);
          return { iterations: 0, outputs: [], skipped: true, skipOutput };
        }

        return { iterations, outputs };
      }
      case 'sequence': {
        // Expand sequence: auto-wire dependsOn to previous sibling
        const wiredNodes = node.nodes.map((child, index) => {
          if (index === 0) return child;
          const prev = node.nodes[index - 1];
          return {
            ...child,
            dependsOn: child.dependsOn ?? [prev.id],
          };
        });
        const seqOutputs = await this.executeNodeList(state, wiredNodes, executionPath);
        return seqOutputs;
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
        const _exhaustive: never = node;
        throw new Error(`Unsupported node kind ${(_exhaustive as { kind?: string }).kind ?? 'unknown'}`);
      }
    }
  }

  private resolveInput(
    state: RunnerState<TContext>,
    value: unknown,
    context: FlowExecutionContext<TContext>,
    toStepId: string,
    executionId: string,
    inputPath: string,
  ): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry, index) => this.resolveInput(state, entry, context, toStepId, executionId, `${inputPath}.${index}`));
    }

    if (this.isDataRef(value)) {
      return this.resolveDataRef(state, value, context, toStepId, executionId, inputPath);
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = this.resolveInput(state, entry, context, toStepId, executionId, `${inputPath}.${key}`);
    }
    return out;
  }

  private resolveDataRef(
    state: RunnerState<TContext>,
    ref: DataRef,
    context: FlowExecutionContext<TContext>,
    toStepId: string,
    executionId: string,
    inputPath: string,
  ): unknown {
    switch (ref.kind) {
      case 'fromStep': {
        const value = this.getAtPath(context.getStepOutput(ref.stepId), ref.path);
        this.validateProducerRefPath(state, executionId, ref.stepId, toStepId, ref.path, value, inputPath);
        this.validateConsumerInput(state, toStepId, executionId, value, inputPath, ref.stepId);
        return value;
      }
      case 'fromSteps': {
        const out: Record<string, unknown> = {};
        for (const stepId of ref.stepIds) {
          const value = this.getAtPath(context.getStepOutput(stepId), ref.path);
          this.validateProducerRefPath(state, executionId, stepId, toStepId, ref.path, value, `${inputPath}.${stepId}`);
          this.validateConsumerInput(state, toStepId, executionId, value, `${inputPath}.${stepId}`, stepId);
          out[stepId] = value;
        }
        this.validateConsumerInput(state, toStepId, executionId, out, inputPath, ref.stepIds.join(','));
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

  private validateProducerOutput(
    state: RunnerState<TContext>,
    stepId: string,
    executionId: string,
    output: unknown,
  ): void {
    const contract = getContractForStep(stepId, this.asIndexedFlow(state), state.contracts);
    if (!contract.outputSchema) {
      return;
    }
    const parsed = contract.outputSchema.safeParse(output);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      throw new FlowContractError(state.flow.id, stepId, executionId, stepId, path, issue.message, parsed.error);
    }
  }

  private validateProducerRefPath(
    state: RunnerState<TContext>,
    executionId: string,
    fromStepId: string,
    toStepId: string,
    producerPath: string | undefined,
    value: unknown,
    inputPath: string,
  ): void {
    const contract = getContractForStep(fromStepId, this.asIndexedFlow(state), state.contracts);
    if (!contract.outputSchema) {
      return;
    }
    const expectedSchema = schemaAtPath(contract.outputSchema, producerPath);
    if (!expectedSchema) {
      const refPath = producerPath && producerPath.length > 0 ? producerPath : '<root>';
      throw new FlowContractError(state.flow.id, toStepId, executionId, fromStepId, inputPath, `Producer schema path '${refPath}' does not exist`);
    }
    const parsed = expectedSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new FlowContractError(state.flow.id, toStepId, executionId, fromStepId, inputPath, issue.message, parsed.error);
    }
  }

  private validateConsumerInput(
    state: RunnerState<TContext>,
    toStepId: string,
    executionId: string,
    value: unknown,
    inputPath: string,
    fromStepId: string,
  ): void {
    const contract = getContractForStep(toStepId, this.asIndexedFlow(state), state.contracts);
    if (!contract.inputSchema) {
      return;
    }
    const targetSchema = schemaAtPath(contract.inputSchema, inputPath.replace(/^input\.?/, ''));
    if (!targetSchema) {
      throw new FlowContractError(
        state.flow.id,
        toStepId,
        executionId,
        fromStepId,
        inputPath,
        `Consumer schema path '${inputPath.replace(/^input\.?/, '') || '<root>'}' does not exist`,
      );
    }
    const parsed = targetSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new FlowContractError(state.flow.id, toStepId, executionId, fromStepId, inputPath, issue.message, parsed.error);
    }
  }

  private asIndexedFlow(state: RunnerState<TContext>): IndexedFlow {
    const nodes: IndexedFlow['nodes'] = new Map();
    for (const [id, node] of state.indexedNodes) {
      nodes.set(id, {
        id,
        inputSchema: 'inputSchema' in node ? node.inputSchema : undefined,
        outputSchema: 'outputSchema' in node ? node.outputSchema : undefined,
      });
    }
    return { nodes };
  }

  private indexNodes(nodes: FlowNode<TContext>[]): Map<string, FlowNode<TContext>> {
    const indexed = new Map<string, FlowNode<TContext>>();
    const visit = (items: FlowNode<TContext>[]): void => {
      for (const node of items) {
        if (!indexed.has(node.id)) {
          indexed.set(node.id, node);
        }
        if (node.kind === 'conditional') {
          visit(node.then);
          visit(node.else ?? []);
        }
        if (node.kind === 'loop') {
          visit(node.do);
        }
        if (node.kind === 'sequence') {
          visit(node.nodes);
        }
        if (node.kind === 'parallel') {
          for (const branch of Object.values(node.branches)) {
            visit(branch);
          }
        }
      }
    };
    visit(nodes);
    return indexed;
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
