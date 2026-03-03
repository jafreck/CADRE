import { z } from 'zod';
import { fromStep, step, type StepContract } from './index.js';

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
    value: fromStep<Contracts, 'producer'>('producer'),
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
