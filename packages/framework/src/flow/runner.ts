import pLimit from 'p-limit';
import { getContractForStep, mergeContracts, schemaAtPath, validateFlowContracts, type IndexedFlow } from './contracts.js';
import {
  FlowContractError,
  FlowCycleError,
  FlowExecutionError,
  FlowLoopExhaustionError,
  type DataRef,
  type FlowCheckpointSnapshot,
  type FlowContracts,
  type FlowDefinition,
  type FlowExecutionContext,
  type FlowNode,
  type FlowLifecycleEvent,
  type FlowLoopResult,
  type FlowRunResult,
  type FlowRunnerOptions,
  type FlowRunStatus,
} from './types.js';

interface RunnerState<TContext> {
  flow: FlowDefinition<TContext>;
  indexedNodes: Map<string, FlowNode<TContext>>;
  contracts: FlowContracts;
  context: TContext;
  outputs: Record<string, unknown>;
  executionOutputs: Record<string, unknown>;
  completedExecutionIds: Set<string>;
  failedExecutionIds: Set<string>;
  hadError: boolean;
  lastError?: FlowExecutionError;
  startedAt: string;
  aborted: boolean;
  abortReason?: FlowRunStatus;
  controller: AbortController;
  options: Required<Pick<FlowRunnerOptions<TContext>, 'concurrency' | 'continueOnError'>>
    & Pick<FlowRunnerOptions<TContext>, 'checkpoint' | 'hooks' | 'timeoutMs' | 'signal'>
    & { concurrentNodes: boolean };
}

interface NodeExecutionOutcome {
  output: unknown;
  attempt: number;
  startedAt: string;
}

export class FlowRunner<TContext = Record<string, unknown>> {
  constructor(private readonly defaults: FlowRunnerOptions<TContext> = {}) {}

  async run(flow: FlowDefinition<TContext>, context: TContext, options: FlowRunnerOptions<TContext> = {}): Promise<FlowRunResult<TContext>> {
    const merged: RunnerState<TContext>['options'] = {
      concurrency: options.concurrency ?? this.defaults.concurrency ?? Number.POSITIVE_INFINITY,
      continueOnError: options.continueOnError ?? this.defaults.continueOnError ?? false,
      concurrentNodes: options.concurrentNodes ?? this.defaults.concurrentNodes ?? false,
      checkpoint: options.checkpoint ?? this.defaults.checkpoint,
      hooks: options.hooks ?? this.defaults.hooks,
      timeoutMs: options.timeoutMs ?? this.defaults.timeoutMs,
      signal: options.signal ?? this.defaults.signal,
    };
    const externalSignal = merged.signal;
    const controller = new AbortController();
    merged.signal = controller.signal;

    // Validate all dependsOn references point to real node IDs
    this.validateDependsOnRefs(flow);

    const startedAt = new Date().toISOString();
    const state: RunnerState<TContext> = {
      flow,
      indexedNodes: this.indexNodes(flow.nodes),
      contracts: mergeContracts(flow.contracts, options.contracts ?? this.defaults.contracts),
      context,
      outputs: {},
      executionOutputs: {},
      completedExecutionIds: new Set(),
      failedExecutionIds: new Set(),
      hadError: false,
      startedAt,
      aborted: false,
      controller,
      options: merged,
    };

    await this.loadCheckpoint(state);

    // Wire up external abort signal
    let removeExternalAbortListener: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        state.aborted = true;
        state.abortReason = 'cancelled';
        controller.abort(externalSignal.reason);
      } else {
        const onAbort = (): void => {
          state.aborted = true;
          state.abortReason = 'cancelled';
          controller.abort(externalSignal.reason);
        };
        externalSignal.addEventListener('abort', onAbort, { once: true });
        removeExternalAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
      }
    }

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

    // Flow-level timeout
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (merged.timeoutMs && merged.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        state.aborted = true;
        state.abortReason = 'timed-out';
        controller.abort(new Error(`Flow '${flow.id}' timed out after ${merged.timeoutMs}ms`));
      }, merged.timeoutMs);
    }

    try {
      await this.executeNodeList(state, flow.nodes, [flow.id]);
      const finishedAt = new Date().toISOString();
      const status: FlowRunStatus = state.aborted
        ? (state.abortReason ?? 'cancelled')
        : state.hadError ? 'failed' : 'completed';
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
      const status: FlowRunStatus = state.aborted
        ? (state.abortReason ?? 'cancelled')
        : 'failed';
      await this.persistCheckpoint(state, status, wrapped.message);
      if (!merged.continueOnError && !state.aborted) {
        throw wrapped;
      }
      return {
        flowId: flow.id,
        status,
        outputs: { ...state.outputs },
        executionOutputs: { ...state.executionOutputs },
        context: state.context,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        completedExecutionIds: [...state.completedExecutionIds],
        error: wrapped,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      removeExternalAbortListener?.();
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
    // Restore context from checkpoint if available
    if (snapshot.context !== undefined) {
      state.context = snapshot.context;
    }
  }

  private async persistCheckpoint(
    state: RunnerState<TContext>,
    status: FlowRunStatus,
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

  private buildExecutionContext(
    state: RunnerState<TContext>,
    executionPath: string[],
    executionId = executionPath.join('/'),
    attempt = 1,
    signal: AbortSignal = state.options.signal!,
    startedAt = new Date().toISOString(),
  ): FlowExecutionContext<TContext> {
    return {
      flowId: state.flow.id,
      executionId,
      executionPath,
      attempt,
      startedAt,
      signal,
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
    signal: AbortSignal = state.options.signal!,
  ): Promise<Record<string, unknown>> {
    if (state.options.concurrentNodes) {
      return this.executeNodeListConcurrent(state, nodes, executionPath, signal);
    }
    return this.executeNodeListSequential(state, nodes, executionPath, signal);
  }

  // ── Sequential path (default — preserves declaration-order execution) ─────

  private async executeNodeListSequential(
    state: RunnerState<TContext>,
    nodes: FlowNode<TContext>[],
    executionPath: string[],
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.validateNodeIds(nodes, executionPath.join('/'));

    const pending = [...nodes];
    const localResolved = new Set<string>();
    const localFailed = new Set<string>();
    const localOutputs: Record<string, unknown> = {};

    while (pending.length > 0) {
      // Check for abort
      if (signal.aborted) break;

      const ready = pending.filter((node) => (node.dependsOn ?? []).every((dependency) => localResolved.has(dependency)));

      if (ready.length === 0) {
        const unresolved = pending.map((node) => node.id).join(', ');
        throw new FlowCycleError(`No executable nodes remain in scope ${executionPath.join('/')} (pending: ${unresolved})`);
      }

      for (const node of ready) {
        if (signal.aborted) break;

        const executionId = `${executionPath.join('/')}/${node.id}`;

        // ── Upstream failure propagation ───────────────────────────────
        const failedDeps = (node.dependsOn ?? []).filter((d) => localFailed.has(d));
        if (failedDeps.length > 0) {
          const now = new Date().toISOString();
          if (state.options.hooks?.onUpstreamFailure) {
            const output = await state.options.hooks.onUpstreamFailure(node.id, node, failedDeps);
            localOutputs[node.id] = output;
            state.outputs[node.id] = output;
          }
          state.hadError = true;
          localResolved.add(node.id);
          localFailed.add(node.id);
          state.failedExecutionIds.add(executionId);
          await this.emitLifecycle(state, {
            type: 'node-upstream-failed', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: [...executionPath, node.id], attempt: 0,
            startedAt: now, finishedAt: now, durationMs: 0,
            reason: 'upstream-failure', failedDependencies: failedDeps,
          });
          await this.persistCheckpoint(state, 'failed');
          const index = pending.findIndex((candidate) => candidate.id === node.id);
          pending.splice(index, 1);
          continue;
        }

        if (state.completedExecutionIds.has(executionId)) {
          await state.options.hooks?.onNodeSkip?.(node.id, node);
          const now = new Date().toISOString();
          await this.emitLifecycle(state, {
            type: 'node-skipped', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: [...executionPath, node.id], attempt: 0,
            startedAt: now, finishedAt: now, durationMs: 0, reason: 'checkpoint',
          });
          localResolved.add(node.id);
          localOutputs[node.id] = state.executionOutputs[executionId];
          const index = pending.findIndex((candidate) => candidate.id === node.id);
          pending.splice(index, 1);
          continue;
        }

        try {
          const outcome = await this.executeNodeWithRetry(state, node, [...executionPath, node.id], executionId, signal);
          const output = outcome.output;
          state.outputs[node.id] = output;
          state.executionOutputs[executionId] = output;
          state.completedExecutionIds.add(executionId);
          localOutputs[node.id] = output;
          localResolved.add(node.id);
          await state.options.hooks?.onNodeComplete?.(node.id, node, output);
          const finishedAt = new Date().toISOString();
          await this.emitLifecycle(state, {
            type: 'node-complete', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: [...executionPath, node.id],
            attempt: outcome.attempt, startedAt: outcome.startedAt, finishedAt,
            durationMs: Date.parse(finishedAt) - Date.parse(outcome.startedAt), output,
          });
          await this.persistCheckpoint(state, 'completed');
        } catch (error) {
          const wrapped = this.wrapError(state.flow.id, node.id, executionId, error);
          if (signal.aborted) {
            state.lastError = wrapped;
            throw wrapped;
          }
          state.hadError = true;
          state.lastError = wrapped;
          localResolved.add(node.id);
          localFailed.add(node.id);
          state.failedExecutionIds.add(executionId);
          await this.persistCheckpoint(state, 'failed', wrapped.message);
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

  // ── Concurrent path (event-driven, fine-grained dep scheduling) ───────────

  private async executeNodeListConcurrent(
    state: RunnerState<TContext>,
    nodes: FlowNode<TContext>[],
    executionPath: string[],
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.validateNodeIds(nodes, executionPath.join('/'));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const localResolved = new Set<string>();
    const localFailed = new Set<string>();
    const localOutputs: Record<string, unknown> = {};
    const limit = pLimit(state.options.concurrency);

    while (localResolved.size < nodeMap.size && !signal.aborted) {
      const ready = [...nodeMap.values()].filter(node =>
        !localResolved.has(node.id) &&
        (node.dependsOn ?? []).every(dependency => localResolved.has(dependency)),
      );
      if (ready.length === 0) {
        const unresolved = [...nodeMap.keys()].filter((id) => !localResolved.has(id)).join(', ');
        throw new FlowCycleError(`No executable nodes remain in scope ${executionPath.join('/')} (pending: ${unresolved})`);
      }

      const scope = this.createLinkedController(signal);
      let firstFatalError: FlowExecutionError | undefined;
      const jobs = ready.map(node => limit(async () => {
        if (scope.controller.signal.aborted) return;
        const executionId = `${executionPath.join('/')}/${node.id}`;
        const nodePath = [...executionPath, node.id];
        const failedDeps = (node.dependsOn ?? []).filter(dependency => localFailed.has(dependency));

        if (failedDeps.length > 0) {
          const now = new Date().toISOString();
          const output = await state.options.hooks?.onUpstreamFailure?.(node.id, node, failedDeps);
          if (output !== undefined) {
            localOutputs[node.id] = output;
            state.outputs[node.id] = output;
          }
          state.hadError = true;
          localResolved.add(node.id);
          localFailed.add(node.id);
          state.failedExecutionIds.add(executionId);
          await this.emitLifecycle(state, {
            type: 'node-upstream-failed', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: nodePath, attempt: 0,
            startedAt: now, finishedAt: now, durationMs: 0,
            reason: 'upstream-failure', failedDependencies: failedDeps,
          });
          await this.persistCheckpoint(state, 'failed');
          return;
        }

        if (state.completedExecutionIds.has(executionId)) {
          await state.options.hooks?.onNodeSkip?.(node.id, node);
          const now = new Date().toISOString();
          await this.emitLifecycle(state, {
            type: 'node-skipped', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: nodePath, attempt: 0,
            startedAt: now, finishedAt: now, durationMs: 0, reason: 'checkpoint',
          });
          localResolved.add(node.id);
          localOutputs[node.id] = state.executionOutputs[executionId];
          return;
        }

        try {
          const outcome = await this.executeNodeWithRetry(
            state, node, nodePath, executionId, scope.controller.signal,
          );
          if (scope.controller.signal.aborted) return;
          const output = outcome.output;
          state.outputs[node.id] = output;
          state.executionOutputs[executionId] = output;
          state.completedExecutionIds.add(executionId);
          localOutputs[node.id] = output;
          localResolved.add(node.id);
          await state.options.hooks?.onNodeComplete?.(node.id, node, output);
          const finishedAt = new Date().toISOString();
          await this.emitLifecycle(state, {
            type: 'node-complete', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath: nodePath, attempt: outcome.attempt,
            startedAt: outcome.startedAt, finishedAt,
            durationMs: Date.parse(finishedAt) - Date.parse(outcome.startedAt), output,
          });
          await this.persistCheckpoint(state, 'completed');
        } catch (error) {
          const wrapped = this.wrapError(state.flow.id, node.id, executionId, error);
          if (scope.controller.signal.aborted && firstFatalError) return;
          state.hadError = true;
          state.lastError = wrapped;
          localResolved.add(node.id);
          localFailed.add(node.id);
          state.failedExecutionIds.add(executionId);
          await this.persistCheckpoint(state, 'failed', wrapped.message);
          if (!state.options.continueOnError && !firstFatalError) {
            firstFatalError = wrapped;
            scope.controller.abort(wrapped);
          }
        }
      }));

      await Promise.allSettled(jobs);
      scope.unlink();
      if (firstFatalError) throw firstFatalError;
    }

    return localOutputs;
  }

  // ── Per-node retry + timeout wrapper ───────────────────────────────────────

  private async executeNodeWithRetry(
    state: RunnerState<TContext>,
    node: FlowNode<TContext>,
    executionPath: string[],
    executionId: string,
    signal: AbortSignal,
  ): Promise<NodeExecutionOutcome> {
    const maxAttempts = (node.retry?.maxAttempts ?? 0) + 1;
    const backoff = node.retry?.backoff ?? 'fixed';
    const baseDelay = node.retry?.delayMs ?? 1000;

    let lastError: unknown;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
      const attempt = attemptIndex + 1;
      if (signal.aborted) {
        throw new Error(`Flow aborted (${state.abortReason ?? 'cancelled'})`);
      }
      const startedAt = new Date().toISOString();
      await state.options.hooks?.onNodeStart?.(node.id, node);
      await this.emitLifecycle(state, {
        type: 'node-start', flowId: state.flow.id, nodeId: node.id, node,
        executionId, executionPath, attempt, startedAt,
      });
      try {
        const output = await this.executeNodeWithTimeout(
          state, node, executionPath, executionId, attempt, signal, startedAt,
        );
        if (signal.aborted) throw new Error(`Flow aborted (${state.abortReason ?? 'cancelled'})`);
        return { output, attempt, startedAt };
      } catch (error) {
        lastError = error;
        const wrapped = this.wrapError(state.flow.id, node.id, executionId, error);
        const finishedAt = new Date().toISOString();
        if (signal.aborted) {
          await this.emitLifecycle(state, {
            type: 'node-cancelled', flowId: state.flow.id, nodeId: node.id, node,
            executionId, executionPath, attempt, startedAt, finishedAt,
            durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
            error: wrapped,
            reason: state.abortReason === 'timed-out' ? 'timed-out' : 'cancelled',
          });
          throw wrapped;
        }
        const willRetry = attemptIndex < maxAttempts - 1;
        await this.emitLifecycle(state, {
          type: 'node-failed', flowId: state.flow.id, nodeId: node.id, node,
          executionId, executionPath, attempt, startedAt, finishedAt,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
          error: wrapped, willRetry,
          ...(wrapped.message.includes('timed out') ? { reason: 'timed-out' as const } : {}),
        });
        if (willRetry) {
          const delay = backoff === 'exponential'
            ? baseDelay * Math.pow(2, attemptIndex)
            : backoff === 'linear'
              ? baseDelay * attempt
              : baseDelay;
          await this.waitForDelay(delay, signal);
        }
      }
    }
    throw lastError;
  }

  private async executeNodeWithTimeout(
    state: RunnerState<TContext>,
    node: FlowNode<TContext>,
    executionPath: string[],
    executionId: string,
    attempt: number,
    signal: AbortSignal,
    startedAt: string,
  ): Promise<unknown> {
    if (!node.timeoutMs || node.timeoutMs <= 0) {
      return this.executeNode(state, node, executionPath, executionId, attempt, signal, startedAt);
    }

    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort(signal.reason);
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onParentAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Node '${node.id}' timed out after ${node.timeoutMs}ms`));
    }, node.timeoutMs);

    try {
      const output = await this.executeNode(
        state, node, executionPath, executionId, attempt, controller.signal, startedAt,
      );
      if (timedOut) {
        throw new FlowExecutionError(
          `Node '${node.id}' timed out after ${node.timeoutMs}ms`,
          state.flow.id, node.id, executionId,
        );
      }
      return output;
    } catch (error) {
      if (timedOut) {
        throw new FlowExecutionError(
          `Node '${node.id}' timed out after ${node.timeoutMs}ms`,
          state.flow.id, node.id, executionId, error,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  private async executeNode(
    state: RunnerState<TContext>,
    node: FlowNode<TContext>,
    executionPath: string[],
    executionId: string,
    attempt: number,
    signal: AbortSignal,
    startedAt: string,
  ): Promise<unknown> {
    const context = this.buildExecutionContext(state, executionPath, executionId, attempt, signal, startedAt);
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
        const branchOutputs = await this.executeNodeList(state, branch, [...executionPath, branchKey], signal);
        return { branch: branchKey, outputs: branchOutputs };
      }
      case 'loop': {
        const outputs: unknown[] = [];
        let iterations = 0;
        let termination: FlowLoopResult['termination'] = 'max-iterations';
        let converged = false;

        while (iterations < node.maxIterations) {
          if (signal.aborted) {
            termination = 'cancelled';
            break;
          }
          const loopCtx = this.buildExecutionContext(
            state, [...executionPath, `iteration-${iterations + 1}`],
            executionId, attempt, signal, startedAt,
          );
          if (node.while) {
            const shouldContinue = await node.while(loopCtx);
            if (!shouldContinue) {
              termination = 'while';
              converged = true;
              break;
            }
          }

          const iterationOutputs = await this.executeNodeList(
            state,
            node.do,
            [...executionPath, `iteration-${iterations + 1}`],
            signal,
          );
          outputs.push(iterationOutputs);
          iterations += 1;

          if (node.until) {
            const done = await node.until(this.buildExecutionContext(
              state, [...executionPath, `iteration-${iterations}`],
              executionId, attempt, signal, startedAt,
            ));
            if (done) {
              termination = 'until';
              converged = true;
              break;
            }
          }
        }

        if (signal.aborted) termination = 'cancelled';
        const result: FlowLoopResult = {
          iterations,
          outputs,
          termination,
          converged,
          exhausted: termination === 'max-iterations',
        };

        // Fire onSkip when the loop ran 0 iterations
        if (iterations === 0 && node.onSkip) {
          const skipCtx = this.buildExecutionContext(
            state, executionPath, executionId, attempt, signal, startedAt,
          );
          const skipOutput = await node.onSkip(skipCtx);
          result.skipped = true;
          result.skipOutput = skipOutput;
        }

        if (node.requireConvergence && result.exhausted) {
          throw new FlowLoopExhaustionError(state.flow.id, node.id, executionId, result);
        }
        return result;
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
        const seqOutputs = await this.executeNodeList(state, wiredNodes, executionPath, signal);
        return seqOutputs;
      }
      case 'parallel': {
        const entries = Object.entries(node.branches);
        const branchResults: Record<string, unknown> = {};
        const limit = pLimit(Math.max(1, Math.floor(node.concurrency ?? state.options.concurrency)));
        const scope = this.createLinkedController(signal);
        let firstError: unknown;
        const jobs = entries.map(([branchId, branchNodes]) => limit(async () => {
          if (scope.controller.signal.aborted) return;
          try {
            const result = await this.executeNodeList(
              state, branchNodes, [...executionPath, branchId], scope.controller.signal,
            );
            if (!scope.controller.signal.aborted) branchResults[branchId] = result;
          } catch (error) {
            if (firstError === undefined) {
              firstError = error;
              scope.controller.abort(error);
            }
          }
        }));
        await Promise.allSettled(jobs);
        scope.unlink();
        if (firstError !== undefined) throw firstError;

        return branchResults;
      }
      case 'map': {
        const items = resolvedInput as unknown[];
        if (!Array.isArray(items)) {
          throw new FlowExecutionError(
            `Map node '${node.id}' requires array input, got ${typeof items}`,
            state.flow.id,
            node.id,
            executionId,
          );
        }
        const mapLimit = pLimit(Math.max(1, Math.floor(node.concurrency ?? state.options.concurrency)));
        const scope = this.createLinkedController(signal);
        let firstError: unknown;
        const results = new Array<unknown>(items.length);
        const jobs = items.map((item, index) => mapLimit(async () => {
          if (scope.controller.signal.aborted) return;
          try {
            const itemCtx = this.buildExecutionContext(
              state, [...executionPath, `item-${index}`],
              `${executionId}/item-${index}`, attempt, scope.controller.signal, startedAt,
            );
            const output = await node.do(itemCtx, item, index);
            if (!scope.controller.signal.aborted) results[index] = output;
          } catch (error) {
            if (firstError === undefined) {
              firstError = error;
              scope.controller.abort(error);
            }
          }
        }));
        await Promise.allSettled(jobs);
        scope.unlink();
        if (firstError !== undefined) throw firstError;
        return results;
      }
      case 'catch': {
        let tryOutput: unknown;
        let caughtError: Error | undefined;
        try {
          tryOutput = await this.executeNodeList(state, node.try, [...executionPath, 'try'], signal);
        } catch (error) {
          caughtError = error instanceof Error ? error : new Error(String(error));
          const catchCtx = this.buildExecutionContext(
            state, [...executionPath, 'catch'], executionId, attempt, signal, startedAt,
          );
          tryOutput = await node.catch(catchCtx, caughtError);
        }
        if (node.finally) {
          await this.executeNodeList(state, node.finally, [...executionPath, 'finally'], signal);
        }
        return { output: tryOutput, caught: caughtError?.message };
      }
      case 'subflow': {
        const childFlow = typeof node.flow === 'function'
          ? await node.flow(context)
          : node.flow;
        const childContext = await node.contextMap(context, resolvedInput);
        const childRunner = new FlowRunner();
        const configuredChildOptions = typeof node.runnerOptions === 'function'
          ? await node.runnerOptions(context, resolvedInput)
          : (node.runnerOptions ?? {});
        const childOptions: FlowRunnerOptions = { ...configuredChildOptions };
        const combinedSignal = this.combineSignals([signal, childOptions.signal]);
        childOptions.signal = combinedSignal.signal;
        // Inherit continueOnError from parent when not explicitly set
        if (state.options.continueOnError && childOptions.continueOnError === undefined) {
          childOptions.continueOnError = state.options.continueOnError;
        }
        const parentEventHook = state.options.hooks?.onEvent;
        const childEventHook = childOptions.hooks?.onEvent;
        if (parentEventHook || childEventHook) {
          childOptions.hooks = {
            ...(childOptions.hooks ?? {}),
            onEvent: async (event) => {
              await parentEventHook?.(event as FlowLifecycleEvent<TContext>);
              if (childEventHook !== parentEventHook) await childEventHook?.(event);
            },
          };
        }
        let result;
        try {
          result = await childRunner.run(childFlow, childContext, childOptions);
        } finally {
          combinedSignal.dispose();
        }
        if (result.status === 'failed' && result.error) {
          throw result.error;
        }
        if (result.status === 'cancelled' || result.status === 'timed-out') {
          throw new FlowExecutionError(
            `Subflow '${childFlow.id}' ${result.status}`,
            state.flow.id,
            node.id,
            executionId,
          );
        }
        return { flowId: result.flowId, status: result.status, outputs: result.outputs };
      }
      default: {
        const _exhaustive: never = node;
        throw new Error(`Unsupported node kind ${(_exhaustive as { kind?: string }).kind ?? 'unknown'}`);
      }
    }
  }

  private createLinkedController(parent: AbortSignal): {
    controller: AbortController;
    unlink: () => void;
  } {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(parent.reason);
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onAbort, { once: true });
    return {
      controller,
      unlink: () => parent.removeEventListener('abort', onAbort),
    };
  }

  private combineSignals(signals: Array<AbortSignal | undefined>): {
    signal: AbortSignal;
    dispose: () => void;
  } {
    const controller = new AbortController();
    const cleanups: Array<() => void> = [];
    for (const signal of signals) {
      if (!signal) continue;
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      const onAbort = (): void => controller.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }
    return {
      signal: controller.signal,
      dispose: () => cleanups.forEach(cleanup => cleanup()),
    };
  }

  private async waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Flow aborted during retry backoff');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('Flow aborted during retry backoff'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async emitLifecycle(
    state: RunnerState<TContext>,
    event: FlowLifecycleEvent<TContext>,
  ): Promise<void> {
    await state.options.hooks?.onEvent?.(event);
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
        if (node.kind === 'catch') {
          visit(node.try);
          if (node.finally) visit(node.finally);
        }
        // subflow nodes are opaque — child flow nodes are not indexed in parent
      }
    };
    visit(nodes);
    return indexed;
  }

  /**
   * Validate that all dependsOn references in a flow point to node IDs
   * that actually exist. Throws FlowCycleError if dangling references found.
   */
  private validateDependsOnRefs(flow: FlowDefinition<TContext>): void {
    const allNodeIds = new Set<string>();
    const danglingRefs: Array<{ nodeId: string; missingDep: string }> = [];

    const collectIds = (items: FlowNode<TContext>[]): void => {
      for (const node of items) {
        allNodeIds.add(node.id);
        if (node.kind === 'conditional') { collectIds(node.then); collectIds(node.else ?? []); }
        if (node.kind === 'loop') { collectIds(node.do); }
        if (node.kind === 'sequence') { collectIds(node.nodes); }
        if (node.kind === 'parallel') { for (const b of Object.values(node.branches)) collectIds(b); }
        if (node.kind === 'catch') { collectIds(node.try); if (node.finally) collectIds(node.finally); }
        // subflow nodes are opaque — child node IDs are not in parent scope
      }
    };
    collectIds(flow.nodes);

    const checkDeps = (items: FlowNode<TContext>[]): void => {
      for (const node of items) {
        for (const dep of node.dependsOn ?? []) {
          if (!allNodeIds.has(dep)) {
            danglingRefs.push({ nodeId: node.id, missingDep: dep });
          }
        }
        if (node.kind === 'conditional') { checkDeps(node.then); checkDeps(node.else ?? []); }
        if (node.kind === 'loop') { checkDeps(node.do); }
        if (node.kind === 'sequence') { checkDeps(node.nodes); }
        if (node.kind === 'parallel') { for (const b of Object.values(node.branches)) checkDeps(b); }
        if (node.kind === 'catch') { checkDeps(node.try); if (node.finally) checkDeps(node.finally); }
        // subflow nodes are opaque — no child deps to check in parent scope
      }
    };
    checkDeps(flow.nodes);

    if (danglingRefs.length > 0) {
      const details = danglingRefs.map((r) => `node '${r.nodeId}' depends on non-existent '${r.missingDep}'`).join('; ');
      throw new FlowCycleError(`Invalid dependsOn references in flow '${flow.id}': ${details}`);
    }
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
