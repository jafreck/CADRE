# `@cadre-dev/framework/flow` DSL and Runner

`@cadre-dev/framework/flow` provides a declarative flow graph DSL and a generic execution engine (`FlowRunner`) for framework-level orchestration.

## Core DSL

- `defineFlow(id, nodes, description?)`
- `step({ id, run, input?, dependsOn?, timeoutMs?, retry? })`
- `gate({ id, evaluate, input?, dependsOn? })`
- `conditional({ id, when, then, else?, input?, dependsOn? })`
- `loop({ id, do, maxIterations, while?, until?, onSkip?, dependsOn? })`
- `parallel({ id, branches, concurrency?, dependsOn? })`
- `sequence({ id }, nodes)` — auto-wires `dependsOn` to the previous sibling
- `map({ id, do, concurrency?, input?, dependsOn? })` — dynamic fan-out over collections
- `catchError({ id, try, catch, finally? })` — try/catch/finally error handling
- `subflow({ id, flow, contextMap, runnerOptions?, input?, dependsOn? })` — nested flow as a node
- `gatedStep({ id, maxRetries, shouldExecute, run, evaluate })` — convenience combinator for step + gate + retry loop

## Data Routing References

- `fromStep(stepId, path?)`
- `fromSteps(stepIds, path?)`
- `fromContext(path?)`

Path syntax is dot notation (`a.b.c`) and supports array indexes (`items.0.id`).

## Per-Node Timeout and Retry

Every node supports optional `timeoutMs` and `retry` configuration:

```ts
step({
  id: 'flaky-api-call',
  timeoutMs: 30_000,                         // abort if >30s
  retry: {
    maxAttempts: 3,                           // retry up to 3 times
    backoff: 'exponential',                   // 'fixed' | 'linear' | 'exponential'
    delayMs: 1000,                            // base delay between retries
  },
  run: () => callExternalApi(),
})
```

## Contract Validation

Steps can declare `inputSchema` / `outputSchema` (Zod) for compile-time and runtime contract validation:

```ts
import { z } from 'zod';
import { validateFlowContracts } from '@cadre-dev/framework/flow';

const flow = defineFlow('validated', [
  step({
    id: 'producer',
    outputSchema: z.object({ count: z.number() }),
    run: () => ({ count: 42 }),
  }),
  step({
    id: 'consumer',
    input: { data: fromStep('producer', 'count') },
    inputSchema: z.object({ data: z.number() }),
    run: (_ctx, input) => `Got ${input.data}`,
  }),
]);

const result = validateFlowContracts(flow);
// result.valid === true
```

## Lifecycle Hooks

`FlowRunnerOptions` accepts a `hooks` object for monitoring:

```ts
const runner = new FlowRunner({
  hooks: {
    onNodeStart: (nodeId, node) => console.log(`Starting ${nodeId}`),
    onNodeComplete: (nodeId, node, output) => console.log(`Completed ${nodeId}`),
    onNodeSkip: (nodeId) => console.log(`Skipped ${nodeId} (checkpoint)`),
    onUpstreamFailure: (nodeId, node, failedDeps) => {
      console.log(`${nodeId} skipped due to failed deps: ${failedDeps}`);
      return null; // optional recovery output
    },
  },
});
```

## Flow-Level Timeout and Cancellation

```ts
const controller = new AbortController();

const runner = new FlowRunner();
const result = await runner.run(flow, context, {
  timeoutMs: 300_000,            // 5 minute total timeout
  signal: controller.signal,     // external abort
});

// result.status: 'completed' | 'failed' | 'cancelled' | 'timed-out'
```

## Subflow (Nested Flow as a Node)

The `subflow()` DSL node delegates execution to a child `FlowDefinition`. The child flow runs via a nested `FlowRunner` and its outputs are returned as the node's output. Child step IDs are scoped to the child flow and do not collide with parent IDs.

```ts
import { defineFlow, step, subflow, fromStep, fromContext, FlowRunner } from '@cadre-dev/framework/flow';

const analysisFlow = defineFlow<{ issueNumber: number }>('analysis', [
  step({
    id: 'scan',
    input: fromContext('issueNumber'),
    run: (_ctx, num) => ({ files: ['src/index.ts'], issue: num }),
  }),
]);

const pipeline = defineFlow<{ issue: number }>('pipeline', [
  step({ id: 'prepare', run: () => ({ ready: true }) }),
  subflow({
    id: 'run-analysis',
    flow: analysisFlow,
    contextMap: (ctx) => ({ issueNumber: ctx.context.issue }),
    dependsOn: ['prepare'],
  }),
]);

const result = await new FlowRunner<{ issue: number }>().run(pipeline, { issue: 42 });
// result.outputs['run-analysis'] → { flowId: 'analysis', status: 'completed', outputs: { scan: { files: [...], issue: 42 } } }
```

The `flow` property accepts either a `FlowDefinition` or a thunk `(ctx) => FlowDefinition` for lazy/dynamic resolution. The `contextMap` function bridges the parent execution context to the child's context. An optional `runnerOptions` property forwards configuration (hooks, concurrency, etc.) to the child runner.

Abort signals from the parent are automatically propagated to the child. If the child flow fails, the error propagates to the parent.

## Concurrent Execution Mode

By default, nodes execute in declaration order. Set `concurrentNodes: true` to schedule nodes by dependency graph:

```ts
const runner = new FlowRunner({
  concurrency: 4,
  concurrentNodes: true,
});
```

## Flow-Engine Bridge

The bridge adapter connects the flow DSL to the engine's phase pipeline:

```ts
import { manifestToFlow, FlowRunner } from '@cadre-dev/framework/flow';
import type { FlowPhaseContext } from '@cadre-dev/framework/flow';

const flow = manifestToFlow('my-pipeline', manifest, gateMap);
const runner = new FlowRunner<FlowPhaseContext>();
await runner.run(flow, { phaseContext: ctx, gateContext: gateCtx });
```

## Example

```ts
import {
  FlowRunner,
  defineFlow,
  step,
  gate,
  conditional,
  loop,
  parallel,
  fromStep,
  fromSteps,
  fromContext,
} from '@cadre-dev/framework/flow';

type Context = {
  attempts: number;
  payload: { issueNumber: number; labels: string[] };
};

const flow = defineFlow<Context>('issue-pipeline', [
  step({
    id: 'extract-issue',
    input: fromContext('payload.issueNumber'),
    run: (_ctx, issueNumber) => ({ issueNumber, ready: true }),
  }),
  gate({
    id: 'ready-gate',
    input: fromStep('extract-issue.ready'),
    evaluate: (_ctx, ready) => Boolean(ready),
  }),
  parallel({
    id: 'fan-out',
    concurrency: 2,
    branches: {
      files: [
        step({
          id: 'scan-files',
          run: () => ['src/index.ts', 'src/core/runtime.ts'],
        }),
      ],
      deps: [
        step({
          id: 'scan-deps',
          run: () => ['@cadre/observability', '@cadre/execution'],
        }),
      ],
    },
  }),
  loop({
    id: 'retry-loop',
    maxIterations: 3,
    do: [
      conditional({
        id: 'retry-check',
        when: (ctx) => Number(ctx.context.attempts) > 0,
        then: [
          step({
            id: 'stabilize',
            input: fromSteps(['scan-files', 'scan-deps']),
            run: (ctx, refs) => {
              ctx.context.attempts -= 1;
              return refs;
            },
          }),
        ],
        else: [
          step({
            id: 'done',
            run: () => true,
          }),
        ],
      }),
    ],
    until: (ctx) => Boolean(ctx.getStepOutput('done')),
  }),
]);

const runner = new FlowRunner<Context>({ concurrency: 2 });
await runner.run(flow, {
  attempts: 2,
  payload: { issueNumber: 293, labels: ['flow', 'framework'] },
});
```

## Checkpoint Integration

`FlowRunner` accepts a `checkpoint` adapter via options. The adapter can persist snapshots after node completion and at terminal states.

```ts
import type { FlowCheckpointAdapter } from '@cadre-dev/framework/flow';

const checkpoint: FlowCheckpointAdapter = {
  async load(flowId) {
    return null;
  },
  async save(snapshot) {
    // persist snapshot
  },
};

const runner = new FlowRunner({ checkpoint });
```

This package is framework-only for now. Cadre app orchestration migration is tracked separately.
