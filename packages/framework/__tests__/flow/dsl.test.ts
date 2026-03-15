import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineFlow,
  step,
  gate,
  conditional,
  loop,
  parallel,
  sequence,
  map,
  catchError,
  subflow,
  gatedStep,
} from '../../src/flow/dsl.js';

describe('flow DSL builders', () => {
  describe('defineFlow', () => {
    it('creates a flow definition with id, nodes, and optional description', () => {
      const flow = defineFlow('my-flow', [], 'A test flow');
      expect(flow.id).toBe('my-flow');
      expect(flow.nodes).toEqual([]);
      expect(flow.description).toBe('A test flow');
    });

    it('creates a flow without description', () => {
      const flow = defineFlow('bare', []);
      expect(flow.description).toBeUndefined();
    });
  });

  describe('step', () => {
    it('creates a step node with kind and run function', () => {
      const node = step({
        id: 's1',
        name: 'Step One',
        run: () => 42,
      });
      expect(node.kind).toBe('step');
      expect(node.id).toBe('s1');
      expect(node.name).toBe('Step One');
    });

    it('supports input/output schemas', () => {
      const node = step({
        id: 's2',
        inputSchema: z.object({ x: z.number() }),
        outputSchema: z.string(),
        run: (_ctx, input) => `got ${input.x}`,
      });
      expect(node.inputSchema).toBeDefined();
      expect(node.outputSchema).toBeDefined();
    });

    it('supports retry and timeout options', () => {
      const node = step({
        id: 's3',
        timeoutMs: 5000,
        retry: { maxAttempts: 3, backoff: 'exponential', delayMs: 100 },
        run: () => 'done',
      });
      expect(node.timeoutMs).toBe(5000);
      expect(node.retry).toEqual({ maxAttempts: 3, backoff: 'exponential', delayMs: 100 });
    });
  });

  describe('gate', () => {
    it('creates a gate node with evaluate function', () => {
      const node = gate({
        id: 'g1',
        evaluate: () => true,
      });
      expect(node.kind).toBe('gate');
      expect(node.id).toBe('g1');
    });
  });

  describe('conditional', () => {
    it('creates a conditional node with then and else branches', () => {
      const node = conditional({
        id: 'c1',
        when: () => true,
        then: [step({ id: 'yes', run: () => 'yes' })],
        else: [step({ id: 'no', run: () => 'no' })],
      });
      expect(node.kind).toBe('conditional');
      expect(node.then).toHaveLength(1);
      expect(node.else).toHaveLength(1);
    });
  });

  describe('loop', () => {
    it('creates a loop node with maxIterations and do', () => {
      const node = loop({
        id: 'l1',
        maxIterations: 5,
        while: () => true,
        do: [step({ id: 'body', run: () => null })],
      });
      expect(node.kind).toBe('loop');
      expect(node.maxIterations).toBe(5);
      expect(node.do).toHaveLength(1);
    });
  });

  describe('parallel', () => {
    it('creates a parallel node with named branches', () => {
      const node = parallel({
        id: 'p1',
        branches: {
          a: [step({ id: 'a1', run: () => 'a' })],
          b: [step({ id: 'b1', run: () => 'b' })],
        },
        concurrency: 2,
      });
      expect(node.kind).toBe('parallel');
      expect(Object.keys(node.branches)).toEqual(['a', 'b']);
      expect(node.concurrency).toBe(2);
    });
  });

  describe('sequence', () => {
    it('creates a sequence node that wraps child nodes', () => {
      const node = sequence(
        { id: 'seq1', name: 'My Sequence' },
        [
          step({ id: 'first', run: () => 1 }),
          step({ id: 'second', run: () => 2 }),
        ],
      );
      expect(node.kind).toBe('sequence');
      expect(node.id).toBe('seq1');
      expect(node.nodes).toHaveLength(2);
    });

    it('passes dependsOn through to the sequence node', () => {
      const node = sequence(
        { id: 'seq2', dependsOn: ['prev'] },
        [],
      );
      expect(node.dependsOn).toEqual(['prev']);
    });
  });

  describe('map', () => {
    it('creates a map node with do function', () => {
      const node = map({
        id: 'm1',
        concurrency: 3,
        do: (_ctx, item: string, _idx) => item.toUpperCase(),
      });
      expect(node.kind).toBe('map');
      expect(node.id).toBe('m1');
      expect(node.concurrency).toBe(3);
    });
  });

  describe('catchError', () => {
    it('creates a catch node with try, catch, and finally', () => {
      const node = catchError({
        id: 'ce1',
        try: [step({ id: 'risky', run: () => { throw new Error('boom'); } })],
        catch: (_ctx, error) => ({ recovered: true, message: error.message }),
        finally: [step({ id: 'cleanup', run: () => 'cleaned' })],
      });
      expect(node.kind).toBe('catch');
      expect(node.try).toHaveLength(1);
      expect(node.finally).toHaveLength(1);
    });

    it('creates a catch node without finally', () => {
      const node = catchError({
        id: 'ce2',
        try: [step({ id: 'work', run: () => 'ok' })],
        catch: () => 'fallback',
      });
      expect(node.finally).toBeUndefined();
    });
  });

  describe('gatedStep', () => {
    it('creates a sequence containing a loop with uniquely prefixed IDs', () => {
      const node = gatedStep({
        id: 'analysis',
        name: 'Analysis',
        maxRetries: 2,
        shouldExecute: () => true,
        run: () => 'result',
        evaluate: () => true,
      });

      expect(node.kind).toBe('sequence');
      expect(node.id).toBe('analysis');
      const inner = node.nodes[0];
      expect(inner.kind).toBe('loop');
      expect(inner.id).toBe('analysis-execute-with-gate');

      // Inner loop nodes should have prefixed IDs
      if (inner.kind === 'loop') {
        expect(inner.do[0].id).toBe('analysis-run');
        expect(inner.do[1].id).toBe('analysis-gate');
      }
    });

    it('produces unique IDs when multiple gatedSteps are used', () => {
      const a = gatedStep({ id: 'phase-a', maxRetries: 1, shouldExecute: () => true, run: () => null, evaluate: () => true });
      const b = gatedStep({ id: 'phase-b', maxRetries: 1, shouldExecute: () => true, run: () => null, evaluate: () => true });

      // Collect all node IDs
      const collectIds = (nodes: { id: string; kind: string; do?: { id: string }[]; nodes?: { id: string }[] }[]): string[] => {
        const ids: string[] = [];
        for (const n of nodes) {
          ids.push(n.id);
          if ('do' in n && Array.isArray(n.do)) ids.push(...n.do.map((d) => d.id));
          if ('nodes' in n && Array.isArray(n.nodes)) ids.push(...collectIds(n.nodes as typeof nodes));
        }
        return ids;
      };

      const aIds = collectIds([a] as never[]);
      const bIds = collectIds([b] as never[]);

      // No overlapping IDs between a and b
      const overlap = aIds.filter((id) => bIds.includes(id));
      expect(overlap).toEqual([]);
    });
  });

  describe('subflow', () => {
    it('creates a subflow node with kind, flow, and contextMap', () => {
      const childFlow = defineFlow('child', [step({ id: 'c1', run: () => 1 })]);
      const node = subflow({
        id: 'sub1',
        name: 'Nested Flow',
        flow: childFlow,
        contextMap: () => ({}),
      });
      expect(node.kind).toBe('subflow');
      expect(node.id).toBe('sub1');
      expect(node.name).toBe('Nested Flow');
      expect(node.flow).toBe(childFlow);
      expect(typeof node.contextMap).toBe('function');
    });

    it('accepts a thunk for lazy flow resolution', () => {
      const node = subflow({
        id: 'sub2',
        flow: () => defineFlow('dynamic', [step({ id: 'd1', run: () => 'ok' })]),
        contextMap: () => ({}),
      });
      expect(node.kind).toBe('subflow');
      expect(typeof node.flow).toBe('function');
    });

    it('supports dependsOn and runnerOptions', () => {
      const childFlow = defineFlow('child', [step({ id: 'c1', run: () => 1 })]);
      const node = subflow({
        id: 'sub3',
        flow: childFlow,
        contextMap: () => ({}),
        dependsOn: ['prev'],
        runnerOptions: { concurrency: 2 },
      });
      expect(node.dependsOn).toEqual(['prev']);
      expect(node.runnerOptions).toEqual({ concurrency: 2 });
    });
  });
});
