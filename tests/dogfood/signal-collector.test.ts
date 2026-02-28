import { describe, it, expect, beforeEach } from 'vitest';
import { SignalCollector } from '../../src/dogfood/signal-collector.js';
import type { DogfoodSignal } from '../../src/dogfood/types.js';

function makeSignal(overrides: Partial<DogfoodSignal> = {}): DogfoodSignal {
  return {
    subsystem: 'test-subsystem',
    failureMode: 'test-failure',
    message: 'something went wrong',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SignalCollector', () => {
  let collector: SignalCollector;

  beforeEach(() => {
    collector = new SignalCollector();
  });

  it('should start with an empty signals array', () => {
    expect(collector.getSignals()).toEqual([]);
  });

  it('should record a signal and return it via getSignals', () => {
    const signal = makeSignal();
    collector.record(signal);
    expect(collector.getSignals()).toEqual([signal]);
  });

  it('should accumulate multiple signals in order', () => {
    const s1 = makeSignal({ message: 'first' });
    const s2 = makeSignal({ message: 'second' });
    collector.record(s1);
    collector.record(s2);
    expect(collector.getSignals()).toEqual([s1, s2]);
  });

  it('should return a copy from getSignals, not the internal array', () => {
    const signal = makeSignal();
    collector.record(signal);
    const result = collector.getSignals();
    result.push(makeSignal({ message: 'extra' }));
    expect(collector.getSignals()).toHaveLength(1);
  });

  it('should clear all signals', () => {
    collector.record(makeSignal());
    collector.record(makeSignal());
    collector.clear();
    expect(collector.getSignals()).toEqual([]);
  });

  it('should allow recording after clear', () => {
    collector.record(makeSignal({ message: 'before' }));
    collector.clear();
    const after = makeSignal({ message: 'after' });
    collector.record(after);
    expect(collector.getSignals()).toEqual([after]);
  });
});
