import { z } from 'zod';
import { defineFlow, fromStep, step, subflow, type FlowNode, type StepContract } from './index.js';

type Contracts = {
  producer: StepContract<unknown, { value: number }>;
  consumerOk: StepContract<{ value: { value: number } }, string>;
  consumerBad: StepContract<{ value: string }, string>;
};

const _contracts: Contracts = {
  producer: { outputSchema: z.object({ value: z.number() }) },
  consumerOk: { inputSchema: z.object({ value: z.object({ value: z.number() }) }) },
  consumerBad: { inputSchema: z.object({ value: z.string() }) },
};

step<Record<string, unknown>, { value: { value: number } }, string>({
  id: 'consumerOk',
  input: {
    value: fromStep<Contracts, 'producer'>('producer', 'value'),
  },
  run: (_ctx, input) => JSON.stringify(input.value.value),
});

step<Record<string, unknown>, { value: string }, string>({
  id: 'consumerBad',
  input: {
    // @ts-expect-error producer output object is not assignable to consumer string input
    value: fromStep<Contracts, 'producer'>('producer'),
  },
  run: (_ctx, input) => input.value,
});

step<Record<string, unknown>, { value: number }, string>({
  id: 'consumerInvalidPath',
  input: {
    // @ts-expect-error producer output path does not exist on contract output type
    value: fromStep<Contracts, 'producer'>('producer', 'value.missing'),
  },
  run: (_ctx, input) => String(input.value),
});

type ParentContext = { seed: number };
type ChildContext = { value: string };

const childFlow = defineFlow<ChildContext>('typed-child', [
  step<ChildContext>({ id: 'read', run: ctx => ctx.context.value }),
]);

const typedSubflow = subflow<ParentContext, ChildContext>({
  id: 'typed-subflow',
  flow: childFlow,
  contextMap: ctx => ({ value: String(ctx.context.seed) }),
  runnerOptions: ctx => ({ concurrency: ctx.context.seed }),
});

const _heterogeneousNodes: FlowNode<ParentContext>[] = [typedSubflow];
defineFlow('typed-parent', _heterogeneousNodes);

subflow<ParentContext, ChildContext>({
  id: 'invalid-context-map',
  flow: childFlow,
  // @ts-expect-error child context requires a string value
  contextMap: ctx => ({ value: ctx.context.seed }),
});

step<Record<string, unknown>, { value: number }, string>({
  id: 'consumerInvalidProducer',
  input: {
    // @ts-expect-error producer id is not a valid contract key
    value: fromStep<Contracts, 'missingProducer'>('missingProducer'),
  },
  run: (_ctx, input) => String(input.value),
});
