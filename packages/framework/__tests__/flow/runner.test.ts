import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  FlowContractError,
  FlowRunner,
  conditional,
  defineFlow,
  fromContext,
  fromStep,
  fromSteps,
  gate,
  loop,
  parallel,
  step,
  validateFlowContracts,
  type FlowCheckpointAdapter,
  type FlowCheckpointSnapshot,
} from '@cadre-dev/framework/flow';

describe('@cadre/flow FlowRunner', () => {
  it('exposes execution identity, attempt, timing, and cancellation to node work', async () => {
    let captured: Record<string, unknown> | undefined;
    const flow = defineFlow('execution-context', [
      step({
        id: 'work',
        run: (ctx) => {
          captured = {
            executionId: ctx.executionId,
            executionPath: ctx.executionPath,
            attempt: ctx.attempt,
            startedAt: ctx.startedAt,
            signal: ctx.signal,
          };
        },
      }),
    ]);

    await new FlowRunner().run(flow, {});

    expect(captured).toMatchObject({
      executionId: 'execution-context/work',
      executionPath: ['execution-context', 'work'],
      attempt: 1,
    });
    expect(captured?.startedAt).toEqual(expect.any(String));
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
  });

  it('cancels active work, waits for settlement, and does not schedule later nodes', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const flow = defineFlow('active-cancel', [
      step({
        id: 'active',
        run: async (ctx) => {
          order.push('active-start');
          markStarted();
          await waitForAbort(ctx.signal);
          order.push('active-settled');
        },
      }),
      step({ id: 'later', dependsOn: ['active'], run: () => { order.push('later'); } }),
    ]);

    const running = new FlowRunner().run(flow, {}, { signal: controller.signal });
    await started;
    controller.abort();
    const result = await running;

    expect(result.status).toBe('cancelled');
    expect(order).toEqual(['active-start', 'active-settled']);
    expect(result.completedExecutionIds).not.toContain('active-cancel/active');
  });

  it('aborts timed-out node work and waits for it to settle before rejecting', async () => {
    const order: string[] = [];
    const flow = defineFlow('node-timeout', [
      step({
        id: 'slow',
        timeoutMs: 10,
        run: async (ctx) => {
          await waitForAbort(ctx.signal);
          order.push('node-settled');
        },
      }),
    ]);

    await expect(new FlowRunner().run(flow, {})).rejects.toThrow('timed out');
    order.push('runner-returned');

    expect(order).toEqual(['node-settled', 'runner-returned']);
  });

  it('aborts parallel siblings and reaches quiescence before failure returns', async () => {
    const order: string[] = [];
    let markSiblingStarted!: () => void;
    const siblingStarted = new Promise<void>(resolve => { markSiblingStarted = resolve; });
    const flow = defineFlow('parallel-quiescence', [
      parallel({
        id: 'scope',
        branches: {
          failing: [step({ id: 'fail', run: async () => { await siblingStarted; throw new Error('fatal branch'); } })],
          sibling: [step({
            id: 'sibling',
            run: async (ctx) => {
              markSiblingStarted();
              await waitForAbort(ctx.signal);
              order.push('sibling-settled');
            },
          })],
        },
      }),
    ]);

    await expect(new FlowRunner().run(flow, {})).rejects.toThrow('fatal branch');
    order.push('runner-returned');

    expect(order).toEqual(['sibling-settled', 'runner-returned']);
  });

  it('emits ordered lifecycle events with execution identity and attempts', async () => {
    const events: Array<Record<string, unknown>> = [];
    const snapshots: string[] = [];
    const flow = defineFlow('lifecycle', [step({ id: 'ok', run: () => 1 })]);

    await new FlowRunner().run(flow, {}, {
      hooks: { onEvent: event => { events.push(event as unknown as Record<string, unknown>); } },
      checkpoint: {
        load: () => null,
        save: snapshot => { snapshots.push(snapshot.status); },
      },
    });

    expect(events.map(event => event.type)).toEqual(['node-start', 'node-complete']);
    expect(events[0]).toMatchObject({
      flowId: 'lifecycle', nodeId: 'ok', executionId: 'lifecycle/ok', attempt: 1,
    });
    expect(snapshots.at(-1)).toBe('completed');
  });

  it('reports loop convergence and maximum-iteration exhaustion explicitly', async () => {
    const converged = defineFlow('loop-converged', [
      loop({ id: 'repeat', maxIterations: 2, do: [step({ id: 'work', run: () => 1 })], until: () => true }),
    ]);
    const exhausted = defineFlow('loop-exhausted', [
      loop({ id: 'repeat', maxIterations: 2, do: [step({ id: 'work', run: () => 1 })], until: () => false }),
    ]);

    const convergedResult = await new FlowRunner().run(converged, {});
    const exhaustedResult = await new FlowRunner().run(exhausted, {});

    expect(convergedResult.outputs.repeat).toMatchObject({ termination: 'until', converged: true, exhausted: false });
    expect(exhaustedResult.outputs.repeat).toMatchObject({ termination: 'max-iterations', converged: false, exhausted: true });
  });

  it('aborts active work on a flow timeout and returns timed-out after settlement', async () => {
    const order: string[] = [];
    const flow = defineFlow('flow-timeout', [
      step({
        id: 'active',
        run: async ctx => {
          await waitForAbort(ctx.signal);
          order.push('active-settled');
        },
      }),
    ]);

    const result = await new FlowRunner().run(flow, {}, { timeoutMs: 10 });
    order.push('runner-returned');

    expect(result.status).toBe('timed-out');
    expect(order).toEqual(['active-settled', 'runner-returned']);
    expect(result.completedExecutionIds).toEqual([]);
  });

  it('aborts map siblings, stops queued items, and waits for active items', async () => {
    const order: string[] = [];
    let started = 0;
    const flow = defineFlow('map-quiescence', [
      {
        kind: 'map', id: 'items', input: [0, 1, 2, 3], concurrency: 2,
        do: async (ctx, item) => {
          started++;
          if (item === 0) {
            while (started < 2) await delay(1);
            throw new Error('map failure');
          }
          await waitForAbort(ctx.signal);
          order.push(`settled-${item}`);
        },
      },
    ]);

    await expect(new FlowRunner().run(flow, {})).rejects.toThrow('map failure');
    order.push('runner-returned');

    expect(started).toBe(2);
    expect(order).toEqual(['settled-1', 'runner-returned']);
  });

  it('quiesces concurrent top-level nodes before persisting terminal failure', async () => {
    const order: string[] = [];
    const snapshots: FlowCheckpointSnapshot[] = [];
    let markSiblingStarted!: () => void;
    const siblingStarted = new Promise<void>(resolve => { markSiblingStarted = resolve; });
    const flow = defineFlow('concurrent-quiescence', [
      step({ id: 'fail', run: async () => { await siblingStarted; throw new Error('top-level failure'); } }),
      step({
        id: 'sibling',
        run: async ctx => {
          markSiblingStarted();
          await waitForAbort(ctx.signal);
          order.push('sibling-settled');
        },
      }),
    ]);

    await expect(new FlowRunner().run(flow, {}, {
      concurrentNodes: true,
      concurrency: 2,
      checkpoint: { load: () => null, save: snapshot => { snapshots.push(snapshot); } },
    })).rejects.toThrow('top-level failure');
    order.push('runner-returned');

    expect(order).toEqual(['sibling-settled', 'runner-returned']);
    expect(snapshots.at(-1)?.status).toBe('failed');
    expect(snapshots.at(-1)?.completedExecutionIds).not.toContain('concurrent-quiescence/sibling');
  });

  it('emits attempt-aware failure and completion events around retries', async () => {
    const eventTypes: string[] = [];
    let attempts = 0;
    const flow = defineFlow('retry-events', [
      step({
        id: 'retrying', retry: { maxAttempts: 1, delayMs: 0 },
        run: () => {
          attempts++;
          if (attempts === 1) throw new Error('retry me');
          return 'ok';
        },
      }),
    ]);

    await new FlowRunner().run(flow, {}, {
      hooks: { onEvent: event => { eventTypes.push(`${event.type}:${event.attempt}`); } },
    });

    expect(eventTypes).toEqual([
      'node-start:1', 'node-failed:1', 'node-start:2', 'node-complete:2',
    ]);
  });

  it('can require loop convergence and exposes exhaustion evidence', async () => {
    const flow = defineFlow('required-convergence', [
      loop({
        id: 'repeat', maxIterations: 2, requireConvergence: true,
        do: [step({ id: 'work', run: () => 1 })],
        until: () => false,
      }),
    ]);

    await expect(new FlowRunner().run(flow, {})).rejects.toMatchObject({
      name: 'FlowLoopExhaustionError',
      result: { termination: 'max-iterations', exhausted: true, iterations: 2 },
    });
  });

  it('runs a linear flow with data routing from context and prior steps', async () => {
    const runner = new FlowRunner<{ numbers: number[] }>({});

    const flow = defineFlow(
      'linear',
      [
        step({
          id: 'sum',
          input: fromContext('numbers'),
          run: (_ctx, input) => (input as number[]).reduce((total, n) => total + n, 0),
        }),
        gate({
          id: 'positive-check',
          input: fromStep('sum'),
          evaluate: (_ctx, input) => Number(input) > 0,
        }),
        step({
          id: 'double',
          input: { value: fromStep('sum') },
          run: (_ctx, input) => Number((input as { value: number }).value) * 2,
        }),
      ],
    );

    const result = await runner.run(flow, { numbers: [1, 2, 3] });

    expect(result.status).toBe('completed');
    expect(result.outputs.sum).toBe(6);
    expect(result.outputs['positive-check']).toEqual({ passed: true });
    expect(result.outputs.double).toBe(12);
  });

  it('supports conditional branching from runtime state and step outputs', async () => {
    const runner = new FlowRunner<{ threshold: number }>({});

    const flow = defineFlow(
      'conditional-flow',
      [
        step({
          id: 'seed',
          run: () => 7,
        }),
        conditional({
          id: 'branch',
          input: {
            seed: fromStep('seed'),
            threshold: fromContext('threshold'),
          },
          when: (_ctx, input) => {
            const payload = input as { seed: number; threshold: number };
            return payload.seed > payload.threshold;
          },
          then: [
            step({
              id: 'high',
              run: () => 'high-path',
            }),
          ],
          else: [
            step({
              id: 'low',
              run: () => 'low-path',
            }),
          ],
        }),
      ],
    );

    const result = await runner.run(flow, { threshold: 5 });

    expect(result.status).toBe('completed');
    expect(result.outputs.seed).toBe(7);
    expect((result.outputs.branch as { branch: string }).branch).toBe('then');
    expect(result.outputs.high).toBe('high-path');
    expect(result.outputs.low).toBeUndefined();
  });

  it('supports loops with maxIterations and exit condition', async () => {
    const runner = new FlowRunner<{ counter: number }>({});

    const flow = defineFlow(
      'loop-flow',
      [
        loop({
          id: 'repeat',
          maxIterations: 5,
          do: [
            step({
              id: 'inc',
              run: (ctx) => {
                ctx.context.counter += 1;
                return ctx.context.counter;
              },
            }),
          ],
          until: (ctx) => Number(ctx.getStepOutput('inc')) >= 3,
        }),
      ],
    );

    const result = await runner.run(flow, { counter: 0 });

    expect(result.status).toBe('completed');
    expect((result.outputs.repeat as { iterations: number }).iterations).toBe(3);
    expect(result.context.counter).toBe(3);
  });

  it('supports fan-out/fan-in parallel branches with concurrency control', async () => {
    const runner = new FlowRunner({ concurrency: 2 });
    let active = 0;
    let peak = 0;

    const delayed = async (value: number): Promise<number> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return value;
    };

    const flow = defineFlow('parallel-flow', [
      parallel({
        id: 'fan-out',
        concurrency: 2,
        branches: {
          a: [step({ id: 'a1', run: async () => delayed(1) })],
          b: [step({ id: 'b1', run: async () => delayed(2) })],
          c: [step({ id: 'c1', run: async () => delayed(3) })],
        },
      }),
      step({
        id: 'fan-in',
        input: fromStep('fan-out'),
        run: (_ctx, input) => {
          const branches = input as Record<string, Record<string, number>>;
          return branches.a.a1 + branches.b.b1 + branches.c.c1;
        },
      }),
    ]);

    const result = await runner.run(flow, {});

    expect(result.status).toBe('completed');
    expect(result.outputs['fan-in']).toBe(6);
    expect(peak).toBe(2);
  });

  it('supports nested constructs and fromSteps aggregation', async () => {
    const runner = new FlowRunner<{ enabled: boolean }>({});

    const flow = defineFlow('nested', [
      parallel({
        id: 'prep',
        branches: {
          left: [step({ id: 'leftValue', run: () => 10 })],
          right: [step({ id: 'rightValue', run: () => 20 })],
        },
      }),
      loop({
        id: 'iterate',
        maxIterations: 2,
        do: [
          conditional({
            id: 'switch',
            when: (ctx) => Boolean(ctx.context.enabled),
            then: [
              step({
                id: 'merge',
                input: fromSteps(['leftValue', 'rightValue']),
                run: (_ctx, input) => {
                  const values = input as Record<string, number>;
                  return values.leftValue + values.rightValue;
                },
              }),
            ],
            else: [step({ id: 'merge', run: () => 0 })],
          }),
        ],
      }),
    ]);

    const result = await runner.run(flow, { enabled: true });

    expect(result.status).toBe('completed');
    expect(result.outputs.merge).toBe(30);
    expect((result.outputs.iterate as { iterations: number }).iterations).toBe(2);
  });

  it('captures checkpoint snapshots during execution', async () => {
    const snapshots: FlowCheckpointSnapshot[] = [];
    const checkpoint: FlowCheckpointAdapter = {
      load: async () => null,
      save: async (snapshot) => {
        snapshots.push(snapshot);
      },
    };

    const runner = new FlowRunner({ checkpoint });
    const flow = defineFlow('checkpointed', [
      step({ id: 'first', run: () => 1 }),
      step({ id: 'second', run: () => 2, dependsOn: ['first'] }),
    ]);

    const result = await runner.run(flow, {});

    expect(result.status).toBe('completed');
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots.at(-1)?.status).toBe('completed');
    expect(snapshots.at(-1)?.outputs.second).toBe(2);
  });

  it('throws FlowExecutionError on node failure by default', async () => {
    const runner = new FlowRunner();
    const flow = defineFlow('failure', [
      step({ id: 'boom', run: () => { throw new Error('kaboom'); } }),
    ]);

    await expect(runner.run(flow, {})).rejects.toMatchObject({
      name: 'FlowExecutionError',
      flowId: 'failure',
      nodeId: 'boom',
    });
  });

  it('returns failed result when continueOnError is enabled', async () => {
    const runner = new FlowRunner({ continueOnError: true });

    const flow = defineFlow('continue-on-error', [
      step({ id: 'fail', run: () => { throw new Error('nope'); } }),
      step({ id: 'later', run: () => 'after' }),
    ]);

    const result = await runner.run(flow, {});

    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('FlowExecutionError');
    expect(result.outputs.later).toBe('after');
  });

  it('reuses checkpointed completed node execution IDs', async () => {
    const runSpy = vi.fn().mockResolvedValue(123);
    const checkpoint: FlowCheckpointAdapter = {
      load: async () => ({
        flowId: 'resume-flow',
        status: 'failed',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedExecutionIds: ['resume-flow/already'],
        outputs: { already: 42 },
        executionOutputs: { 'resume-flow/already': 42 },
      }),
      save: async () => undefined,
    };

    const runner = new FlowRunner({ checkpoint });
    const flow = defineFlow('resume-flow', [
      step({ id: 'already', run: runSpy }),
      step({ id: 'next', input: fromStep('already'), run: (_ctx, input) => Number(input) + 1 }),
    ]);

    const result = await runner.run(flow, {});

    expect(result.status).toBe('completed');
    expect(runSpy).not.toHaveBeenCalled();
    expect(result.outputs.next).toBe(43);
  });

  it('validates compatible contracts across fromStep and fromSteps routing', async () => {
    const flow = defineFlow('contracts-valid', [
      step({
        id: 'producerA',
        outputSchema: z.object({ score: z.number() }),
        run: () => ({ score: 5 }),
      }),
      step({
        id: 'producerB',
        outputSchema: z.object({ score: z.number() }),
        run: () => ({ score: 7 }),
      }),
      step({
        id: 'consumerOne',
        inputSchema: z.object({ score: z.number() }),
        input: fromStep('producerA'),
        run: (_ctx, input) => (input as { score: number }).score,
      }),
      step({
        id: 'consumerMany',
        inputSchema: z.object({ producerA: z.object({ score: z.number() }), producerB: z.object({ score: z.number() }) }),
        input: fromSteps(['producerA', 'producerB']),
        run: (_ctx, input) => {
          const payload = input as { producerA: { score: number }; producerB: { score: number } };
          return payload.producerA.score + payload.producerB.score;
        },
      }),
    ]);

    const staticValidation = validateFlowContracts(flow);
    expect(staticValidation.valid).toBe(true);

    const result = await new FlowRunner().run(flow, {});
    expect(result.status).toBe('completed');
    expect(result.outputs.consumerOne).toBe(5);
    expect(result.outputs.consumerMany).toBe(12);
  });

  it('reports type mismatch with from-step and to-step details', async () => {
    const flow = defineFlow('contracts-type-mismatch', [
      step({
        id: 'producer',
        outputSchema: z.object({ score: z.number() }),
        run: () => ({ score: 5 }),
      }),
      step({
        id: 'consumer',
        inputSchema: z.object({ score: z.string() }),
        input: fromStep('producer'),
        run: (_ctx, input) => input,
      }),
    ]);

    const staticValidation = validateFlowContracts(flow);
    expect(staticValidation.valid).toBe(false);
    expect(staticValidation.issues[0]).toMatchObject({
      fromStep: 'producer',
      toStep: 'consumer',
      fieldPath: 'input',
    });

    await expect(new FlowRunner().run(flow, {})).rejects.toMatchObject({
      name: 'FlowContractError',
      fromStep: 'producer',
      toStep: 'consumer',
      fieldPath: 'input',
    } satisfies Partial<FlowContractError>);
  });

  it('reports missing producer field/path mismatch', async () => {
    const flow = defineFlow('contracts-missing-field', [
      step({
        id: 'producer',
        outputSchema: z.object({ score: z.number() }),
        run: () => ({ score: 5 }),
      }),
      step({
        id: 'consumer',
        inputSchema: z.object({ score: z.number() }),
        input: fromStep('producer', 'score.value'),
        run: (_ctx, input) => input,
      }),
    ]);

    const staticValidation = validateFlowContracts(flow);
    expect(staticValidation.valid).toBe(false);
    expect(staticValidation.issues[0]?.reason).toContain('does not exist');

    await expect(new FlowRunner().run(flow, {})).rejects.toMatchObject({
      name: 'FlowContractError',
      fromStep: 'producer',
      toStep: 'consumer',
    } satisfies Partial<FlowContractError>);
  });

  it('detects schema evolution incompatibility between producer and consumer versions', async () => {
    const flow = defineFlow('contracts-schema-evolution', [
      step({
        id: 'producerV2',
        outputSchema: z.object({ score: z.string() }),
        run: () => ({ score: '5' }),
      }),
      step({
        id: 'consumerV1',
        inputSchema: z.object({ score: z.number() }),
        input: fromStep('producerV2'),
        run: (_ctx, input) => input,
      }),
    ]);

    const staticValidation = validateFlowContracts(flow);
    expect(staticValidation.valid).toBe(false);
    expect(staticValidation.issues[0]).toMatchObject({
      fromStep: 'producerV2',
      toStep: 'consumerV1',
    });
  });

  describe('onUpstreamFailure hook', () => {
    it('calls onUpstreamFailure for nodes whose dependencies failed', async () => {
      const hook = vi.fn().mockResolvedValue({ depBlocked: true });
      const runner = new FlowRunner({ continueOnError: true });

      const flow = defineFlow('upstream-fail', [
        step({
          id: 'a',
          run: () => { throw new Error('boom'); },
        }),
        step({
          id: 'b',
          dependsOn: ['a'],
          run: () => 'should-not-run',
        }),
      ]);

      const result = await runner.run(flow, {}, { hooks: { onUpstreamFailure: hook } });

      expect(result.status).toBe('failed');
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook).toHaveBeenCalledWith('b', expect.objectContaining({ id: 'b' }), ['a']);
      expect(result.outputs.b).toEqual({ depBlocked: true });
    });

    it('propagates upstream failure transitively', async () => {
      const hook = vi.fn().mockResolvedValue('blocked');
      const runner = new FlowRunner({ continueOnError: true });

      const flow = defineFlow('transitive', [
        step({ id: 'root', run: () => { throw new Error('fail'); } }),
        step({ id: 'mid', dependsOn: ['root'], run: () => 'skip' }),
        step({ id: 'leaf', dependsOn: ['mid'], run: () => 'skip' }),
      ]);

      const result = await runner.run(flow, {}, { hooks: { onUpstreamFailure: hook } });

      expect(hook).toHaveBeenCalledTimes(2);
      expect(hook).toHaveBeenCalledWith('mid', expect.objectContaining({ id: 'mid' }), ['root']);
      expect(hook).toHaveBeenCalledWith('leaf', expect.objectContaining({ id: 'leaf' }), ['mid']);
      expect(result.outputs.mid).toBe('blocked');
      expect(result.outputs.leaf).toBe('blocked');
    });

    it('does not fire for nodes whose dependencies succeeded', async () => {
      const hook = vi.fn();
      const runner = new FlowRunner({ continueOnError: true });

      const flow = defineFlow('no-fail', [
        step({ id: 'a', run: () => 1 }),
        step({ id: 'b', dependsOn: ['a'], run: () => 2 }),
      ]);

      const result = await runner.run(flow, {}, { hooks: { onUpstreamFailure: hook } });

      expect(result.status).toBe('completed');
      expect(hook).not.toHaveBeenCalled();
      expect(result.outputs.b).toBe(2);
    });
  });

  describe('concurrentNodes', () => {
    it('runs independent nodes concurrently when enabled', async () => {
      const runner = new FlowRunner();
      const order: string[] = [];

      const flow = defineFlow('concurrent', [
        step({
          id: 'fast',
          run: async () => { order.push('fast-start'); await delay(10); order.push('fast-end'); return 'f'; },
        }),
        step({
          id: 'slow',
          run: async () => { order.push('slow-start'); await delay(50); order.push('slow-end'); return 's'; },
        }),
        step({
          id: 'last',
          dependsOn: ['fast', 'slow'],
          run: () => { order.push('last'); return 'l'; },
        }),
      ]);

      const result = await runner.run(flow, {}, { concurrentNodes: true, concurrency: 2 });

      expect(result.status).toBe('completed');
      // Both fast and slow should start before either finishes
      expect(order.indexOf('fast-start')).toBeLessThan(order.indexOf('slow-end'));
      expect(order.indexOf('slow-start')).toBeLessThan(order.indexOf('fast-end'));
      expect(order[order.length - 1]).toBe('last');
      expect(result.outputs.last).toBe('l');
    });

    it('respects concurrency limit in concurrent mode', async () => {
      const runner = new FlowRunner();
      let maxConcurrent = 0;
      let active = 0;

      const flow = defineFlow('limit-test', [
        step({ id: 'a', run: async () => { active++; maxConcurrent = Math.max(maxConcurrent, active); await delay(30); active--; } }),
        step({ id: 'b', run: async () => { active++; maxConcurrent = Math.max(maxConcurrent, active); await delay(30); active--; } }),
        step({ id: 'c', run: async () => { active++; maxConcurrent = Math.max(maxConcurrent, active); await delay(30); active--; } }),
      ]);

      await runner.run(flow, {}, { concurrentNodes: true, concurrency: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('fires onUpstreamFailure in concurrent mode', async () => {
      const hook = vi.fn().mockResolvedValue('blocked');
      const runner = new FlowRunner();

      const flow = defineFlow('concurrent-upstream', [
        step({ id: 'fail', run: () => { throw new Error('boom'); } }),
        step({ id: 'ok', run: () => 'fine' }),
        step({ id: 'child', dependsOn: ['fail'], run: () => 'skip' }),
      ]);

      const result = await runner.run(flow, {}, {
        concurrentNodes: true,
        concurrency: 3,
        continueOnError: true,
        hooks: { onUpstreamFailure: hook },
      });

      expect(result.status).toBe('failed');
      expect(hook).toHaveBeenCalledWith('child', expect.objectContaining({ id: 'child' }), ['fail']);
      expect(result.outputs.child).toBe('blocked');
      expect(result.outputs.ok).toBe('fine');
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
}