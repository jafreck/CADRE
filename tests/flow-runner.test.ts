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
} from '@cadre/flow';

describe('@cadre/flow FlowRunner', () => {
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
});
