import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateFlowContracts } from '../../src/flow/contracts.js';
import { defineFlow, step, sequence, conditional, loop, parallel, catchError } from '../../src/flow/dsl.js';
import { fromStep } from '../../src/flow/refs.js';

describe('flow contract validation', () => {
  it('passes when no contracts are defined', () => {
    const flow = defineFlow('test', [
      step({ id: 'a', run: () => 1 }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('detects missing producer step', () => {
    const flow = defineFlow('test', [
      step({
        id: 'consumer',
        input: { data: fromStep('non-existent') },
        inputSchema: z.object({ data: z.string() }),
        run: () => 'ok',
      }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toContain('does not exist');
  });

  it('detects schema incompatibility between producer and consumer', () => {
    const flow = defineFlow('test', [
      step({
        id: 'producer',
        outputSchema: z.object({ value: z.number() }),
        run: () => ({ value: 42 }),
      }),
      step({
        id: 'consumer',
        input: { data: fromStep('producer', 'value') },
        inputSchema: z.object({ data: z.string() }),
        run: () => 'ok',
      }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(false);
  });

  it('passes with compatible schemas', () => {
    const flow = defineFlow('test', [
      step({
        id: 'producer',
        outputSchema: z.object({ value: z.string() }),
        run: () => ({ value: 'hello' }),
      }),
      step({
        id: 'consumer',
        input: { data: fromStep('producer', 'value') },
        inputSchema: z.object({ data: z.string() }),
        run: () => 'ok',
      }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(true);
  });

  it('traverses sequence nodes for contract validation', () => {
    const flow = defineFlow('test', [
      sequence({ id: 'seq' }, [
        step({
          id: 'inner-producer',
          outputSchema: z.object({ count: z.number() }),
          run: () => ({ count: 5 }),
        }),
      ]),
      step({
        id: 'outer-consumer',
        input: { val: fromStep('inner-producer', 'count') },
        inputSchema: z.object({ val: z.number() }),
        run: () => 'ok',
      }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(true);
  });

  it('traverses catch nodes for contract validation', () => {
    const flow = defineFlow('test', [
      catchError({
        id: 'safe-block',
        try: [
          step({
            id: 'try-step',
            outputSchema: z.object({ result: z.string() }),
            run: () => ({ result: 'ok' }),
          }),
        ],
        catch: () => 'fallback',
        finally: [
          step({ id: 'cleanup', run: () => null }),
        ],
      }),
      step({
        id: 'after',
        input: { data: fromStep('try-step', 'result') },
        inputSchema: z.object({ data: z.string() }),
        run: () => 'done',
      }),
    ]);
    const result = validateFlowContracts(flow);
    expect(result.valid).toBe(true);
  });

  it('uses runtime contracts to supplement node-level schemas', () => {
    const flow = defineFlow('test', [
      step({ id: 'a', run: () => ({ x: 1 }) }),
      step({
        id: 'b',
        input: { val: fromStep('a', 'x') },
        run: () => 'ok',
      }),
    ]);
    const runtimeContracts = {
      a: { outputSchema: z.object({ x: z.number() }) },
      b: { inputSchema: z.object({ val: z.number() }) },
    };
    const result = validateFlowContracts(flow, runtimeContracts);
    expect(result.valid).toBe(true);
  });
});
