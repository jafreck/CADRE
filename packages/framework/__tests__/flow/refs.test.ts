import { describe, expect, it } from 'vitest';
import { fromStep, fromSteps, fromContext } from '../../src/flow/refs.js';

describe('flow data refs', () => {
  describe('fromStep', () => {
    it('creates a fromStep ref without path', () => {
      const ref = fromStep('analyzer');
      expect(ref).toEqual({ kind: 'fromStep', stepId: 'analyzer', path: undefined });
    });

    it('creates a fromStep ref with path', () => {
      const ref = fromStep('analyzer', 'result.summary');
      expect(ref).toEqual({ kind: 'fromStep', stepId: 'analyzer', path: 'result.summary' });
    });
  });

  describe('fromSteps', () => {
    it('creates a fromSteps ref collecting outputs from multiple steps', () => {
      const ref = fromSteps(['a', 'b', 'c']);
      expect(ref).toEqual({ kind: 'fromSteps', stepIds: ['a', 'b', 'c'], path: undefined });
    });

    it('supports path on fromSteps', () => {
      const ref = fromSteps(['a', 'b'], 'summary');
      expect(ref).toEqual({ kind: 'fromSteps', stepIds: ['a', 'b'], path: 'summary' });
    });
  });

  describe('fromContext', () => {
    it('creates a fromContext ref without path', () => {
      const ref = fromContext();
      expect(ref).toEqual({ kind: 'fromContext', path: undefined });
    });

    it('creates a fromContext ref with path', () => {
      const ref = fromContext('config.apiKey');
      expect(ref).toEqual({ kind: 'fromContext', path: 'config.apiKey' });
    });
  });
});
