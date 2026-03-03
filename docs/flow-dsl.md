# `@cadre/flow` DSL and Runner

`@cadre/flow` provides a declarative flow graph DSL and a generic execution engine (`FlowRunner`) for framework-level orchestration.

## Core DSL

- `defineFlow(id, nodes, description?)`
- `step({ id, run, input?, dependsOn? })`
- `gate({ id, evaluate, input?, dependsOn? })`
- `conditional({ id, when, then, else?, input?, dependsOn? })`
- `loop({ id, do, maxIterations, while?, until?, dependsOn? })`
- `parallel({ id, branches, concurrency?, dependsOn? })`

## Data Routing References

- `fromStep(stepId, path?)`
- `fromSteps(stepIds, path?)`
- `fromContext(path?)`

Path syntax is dot notation (`a.b.c`) and supports array indexes (`items.0.id`).

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
} from '@cadre/flow';

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
import type { FlowCheckpointAdapter } from '@cadre/flow';

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
