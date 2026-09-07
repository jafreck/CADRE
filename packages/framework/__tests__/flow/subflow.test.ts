import { describe, expect, it, vi } from 'vitest';
import {
  FlowRunner,
  defineFlow,
  fromContext,
  fromStep,
  step,
  subflow,
} from '@cadre-dev/framework/flow';

describe('subflow node', () => {
  it('propagates parent cancellation to active child work and waits for settlement', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const child = defineFlow('active-child', [
      step({
        id: 'active',
        run: async ctx => {
          markStarted();
          await waitForAbort(ctx.signal);
          order.push('child-settled');
        },
      }),
    ]);
    const parent = defineFlow('active-parent', [
      subflow({ id: 'nested', flow: child, contextMap: () => ({}) }),
    ]);

    const running = new FlowRunner().run(parent, {}, { signal: controller.signal });
    await started;
    controller.abort();
    const result = await running;
    order.push('parent-returned');

    expect(result.status).toBe('cancelled');
    expect(order).toEqual(['child-settled', 'parent-returned']);
  });

  it('combines explicit child signal with parent cancellation', async () => {
    const parentController = new AbortController();
    const childController = new AbortController();
    let observedAbort = false;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const child = defineFlow('combined-child', [
      step({
        id: 'active',
        run: async ctx => {
          markStarted();
          await waitForAbort(ctx.signal);
          observedAbort = true;
        },
      }),
    ]);
    const parent = defineFlow('combined-parent', [
      subflow({
        id: 'nested', flow: child, contextMap: () => ({}),
        runnerOptions: { signal: childController.signal },
      }),
    ]);

    const running = new FlowRunner().run(parent, {}, { signal: parentController.signal });
    await started;
    parentController.abort();
    const result = await running;

    expect(result.status).toBe('cancelled');
    expect(observedAbort).toBe(true);
  });

  it('forwards child lifecycle events with child execution identity', async () => {
    const events = vi.fn();
    const child = defineFlow('event-child', [step({ id: 'child-work', run: () => 1 })]);
    const parent = defineFlow('event-parent', [
      subflow({ id: 'nested', flow: child, contextMap: () => ({}) }),
    ]);

    await new FlowRunner().run(parent, {}, { hooks: { onEvent: events } });

    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: 'node-complete', flowId: 'event-child',
      executionId: 'event-parent/nested/event-child/child-work',
    }));
  });

  it('isolates checkpoints when two subflows reuse the same child definition', async () => {
    const snapshots = new Map<string, import('@cadre-dev/framework/flow').FlowCheckpointSnapshot>();
    const checkpoint = {
      load: (flowId: string) => snapshots.get(flowId) ?? null,
      save: (snapshot: import('@cadre-dev/framework/flow').FlowCheckpointSnapshot) => {
        snapshots.set(snapshot.flowId, snapshot);
      },
    };
    const child = defineFlow<{ value: number }>('shared-child', [
      step({ id: 'read', run: ctx => ctx.context.value }),
    ]);
    const parent = defineFlow<{ first: number; second: number }>('checkpoint-parent', [
      subflow({
        id: 'first-child', flow: child,
        contextMap: ctx => ({ value: ctx.context.first }),
        runnerOptions: { checkpoint },
      }),
      subflow({
        id: 'second-child', flow: child,
        contextMap: ctx => ({ value: ctx.context.second }),
        runnerOptions: { checkpoint },
      }),
    ]);

    const result = await new FlowRunner().run(parent, { first: 1, second: 2 });

    expect((result.outputs['first-child'] as { outputs: { read: number } }).outputs.read).toBe(1);
    expect((result.outputs['second-child'] as { outputs: { read: number } }).outputs.read).toBe(2);
    expect([...snapshots.keys()].sort()).toEqual([
      'checkpoint-parent/first-child/shared-child',
      'checkpoint-parent/second-child/shared-child',
    ]);
  });

  it('derives child runner options from the current parent execution', async () => {
    const optionsFactory = vi.fn().mockReturnValue({ concurrency: 1 });
    const child = defineFlow<{ value: number }>('options-child', [
      step({ id: 'read', run: ctx => ctx.context.value }),
    ]);
    const parent = defineFlow<{ value: number }>('options-parent', [
      subflow({
        id: 'nested', flow: child,
        contextMap: ctx => ({ value: ctx.context.value }),
        runnerOptions: optionsFactory,
      }),
    ]);

    const result = await new FlowRunner<{ value: number }>().run(parent, { value: 7 });

    expect(result.status).toBe('completed');
    expect(optionsFactory).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'options-parent/nested', attempt: 1 }),
      undefined,
    );
  });

  it('executes a child flow and returns its outputs', async () => {
    const childFlow = defineFlow<{ value: number }>('child', [
      step({
        id: 'double',
        input: fromContext('value'),
        run: (_ctx, input) => (input as number) * 2,
      }),
    ]);

    const parentFlow = defineFlow<{ seed: number }>('parent', [
      subflow({
        id: 'nested',
        flow: childFlow,
        contextMap: (ctx) => ({ value: ctx.context.seed }),
      }),
    ]);

    const result = await new FlowRunner<{ seed: number }>().run(parentFlow, { seed: 21 });

    expect(result.status).toBe('completed');
    const nestedOutput = result.outputs['nested'] as { flowId: string; status: string; outputs: Record<string, unknown> };
    expect(nestedOutput.flowId).toBe('child');
    expect(nestedOutput.status).toBe('completed');
    expect(nestedOutput.outputs['double']).toBe(42);
  });

  it('passes resolved input to contextMap', async () => {
    const childFlow = defineFlow<{ data: string }>('child-input', [
      step({
        id: 'echo',
        input: fromContext('data'),
        run: (_ctx, input) => input,
      }),
    ]);

    const parentFlow = defineFlow<{ greeting: string }>('parent-input', [
      step({
        id: 'prepare',
        run: () => 'hello world',
      }),
      subflow({
        id: 'nested',
        flow: childFlow,
        input: fromStep('prepare'),
        contextMap: (_ctx, input) => ({ data: input as string }),
        dependsOn: ['prepare'],
      }),
    ]);

    const result = await new FlowRunner<{ greeting: string }>().run(parentFlow, { greeting: 'hi' });

    expect(result.status).toBe('completed');
    const nestedOutput = result.outputs['nested'] as { outputs: Record<string, unknown> };
    expect(nestedOutput.outputs['echo']).toBe('hello world');
  });

  it('supports a thunk that lazily produces the child flow', async () => {
    const parentFlow = defineFlow<{ multiplier: number }>('parent-thunk', [
      subflow({
        id: 'lazy-nested',
        flow: (ctx) =>
          defineFlow<{ mult: number }>('dynamic-child', [
            step({
              id: 'compute',
              input: fromContext('mult'),
              run: (_ctx, input) => (input as number) * 10,
            }),
          ]),
        contextMap: (ctx) => ({ mult: ctx.context.multiplier }),
      }),
    ]);

    const result = await new FlowRunner<{ multiplier: number }>().run(parentFlow, { multiplier: 5 });

    expect(result.status).toBe('completed');
    const nestedOutput = result.outputs['lazy-nested'] as { outputs: Record<string, unknown> };
    expect(nestedOutput.outputs['compute']).toBe(50);
  });

  it('propagates child flow failure to parent', async () => {
    const failingChild = defineFlow('failing-child', [
      step({
        id: 'boom',
        run: () => {
          throw new Error('child exploded');
        },
      }),
    ]);

    const parentFlow = defineFlow('parent-fail', [
      subflow({
        id: 'nested-fail',
        flow: failingChild,
        contextMap: () => ({}),
      }),
    ]);

    await expect(new FlowRunner().run(parentFlow, {})).rejects.toMatchObject({
      message: expect.stringContaining('child exploded'),
    });
  });

  it('propagates abort signal to child flow', async () => {
    const controller = new AbortController();

    const slowChild = defineFlow('slow-child', [
      step({
        id: 'first',
        run: async () => {
          // Abort mid-flight after first step completes
          controller.abort();
          return 'done-first';
        },
      }),
      step({
        id: 'second',
        dependsOn: ['first'],
        run: async () => {
          return 'should-not-run';
        },
      }),
    ]);

    const parentFlow = defineFlow('parent-abort', [
      subflow({
        id: 'nested-abort',
        flow: slowChild,
        contextMap: () => ({}),
      }),
    ]);

    const result = await new FlowRunner({ continueOnError: true }).run(parentFlow, {}, {
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
  });

  it('child step IDs do not collide with parent step IDs', async () => {
    const childFlow = defineFlow<{ prefix: string }>('child', [
      step({
        id: 'shared-name',
        input: fromContext('prefix'),
        run: (_ctx, input) => `child:${input}`,
      }),
    ]);

    const parentFlow = defineFlow<Record<string, unknown>>('parent', [
      step({
        id: 'shared-name',
        run: () => 'parent-value',
      }),
      subflow({
        id: 'nested',
        flow: childFlow,
        input: fromStep('shared-name'),
        contextMap: (_ctx, input) => ({ prefix: input as string }),
        dependsOn: ['shared-name'],
      }),
    ]);

    const result = await new FlowRunner().run(parentFlow, {});

    expect(result.status).toBe('completed');
    // Parent's 'shared-name' should still have its own output
    expect(result.outputs['shared-name']).toBe('parent-value');
    // Child's outputs are namespaced inside the subflow output
    const nested = result.outputs['nested'] as { outputs: Record<string, unknown> };
    expect(nested.outputs['shared-name']).toBe('child:parent-value');
  });

  it('passes custom runnerOptions to child', async () => {
    const hookCalls: string[] = [];

    const childFlow = defineFlow('child-opts', [
      step({ id: 'a', run: () => 1 }),
      step({ id: 'b', run: () => 2 }),
    ]);

    const parentFlow = defineFlow('parent-opts', [
      subflow({
        id: 'nested',
        flow: childFlow,
        contextMap: () => ({}),
        runnerOptions: {
          hooks: {
            onNodeComplete: (nodeId) => {
              hookCalls.push(nodeId);
            },
          },
        },
      }),
    ]);

    await new FlowRunner().run(parentFlow, {});
    expect(hookCalls).toContain('a');
    expect(hookCalls).toContain('b');
  });

  it('works inside a parallel branch', async () => {
    const { parallel } = await import('@cadre-dev/framework/flow');

    const childA = defineFlow<{ label: string }>('child-a', [
      step({ id: 'tag', input: fromContext('label'), run: (_ctx, input) => `a:${input}` }),
    ]);
    const childB = defineFlow<{ label: string }>('child-b', [
      step({ id: 'tag', input: fromContext('label'), run: (_ctx, input) => `b:${input}` }),
    ]);

    const parentFlow = defineFlow('parent-parallel', [
      parallel({
        id: 'fan-out',
        branches: {
          left: [
            subflow({
              id: 'sub-a',
              flow: childA,
              contextMap: () => ({ label: 'left' }),
            }),
          ],
          right: [
            subflow({
              id: 'sub-b',
              flow: childB,
              contextMap: () => ({ label: 'right' }),
            }),
          ],
        },
      }),
    ]);

    const result = await new FlowRunner().run(parentFlow, {});
    expect(result.status).toBe('completed');

    const subA = result.outputs['sub-a'] as { outputs: Record<string, unknown> };
    const subB = result.outputs['sub-b'] as { outputs: Record<string, unknown> };
    expect(subA.outputs['tag']).toBe('a:left');
    expect(subB.outputs['tag']).toBe('b:right');
  });
});

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
}
