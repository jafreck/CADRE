import { describe, it, expect } from 'vitest';
import { TopicAggregator } from '../../src/dogfood/topic-aggregator.js';
import type { DogfoodSignal } from '../../src/dogfood/types.js';

function makeSignal(overrides: Partial<DogfoodSignal> = {}): DogfoodSignal {
  return {
    subsystem: 'parser',
    failureMode: 'timeout',
    message: 'timed out',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TopicAggregator', () => {
  const aggregator = new TopicAggregator();

  it('should return an empty array for empty input', () => {
    expect(aggregator.aggregate([])).toEqual([]);
  });

  it('should create a single topic from one signal', () => {
    const signal = makeSignal({ impactScope: 'global' });
    const topics = aggregator.aggregate([signal]);

    expect(topics).toHaveLength(1);
    expect(topics[0].key).toEqual({
      subsystem: 'parser',
      failureMode: 'timeout',
      impactScope: 'global',
    });
    expect(topics[0].signals).toEqual([signal]);
    expect(topics[0].mergedCount).toBe(1);
    expect(topics[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(topics[0].lastSeen).toBe('2026-01-01T00:00:00Z');
  });

  it('should default impactScope to "unknown" when not provided', () => {
    const signal = makeSignal();
    const topics = aggregator.aggregate([signal]);
    expect(topics[0].key.impactScope).toBe('unknown');
  });

  it('should merge signals with the same subsystem, failureMode, and impactScope', () => {
    const s1 = makeSignal({ timestamp: '2026-01-01T00:00:00Z', impactScope: 'global' });
    const s2 = makeSignal({ timestamp: '2026-01-02T00:00:00Z', impactScope: 'global' });
    const topics = aggregator.aggregate([s1, s2]);

    expect(topics).toHaveLength(1);
    expect(topics[0].mergedCount).toBe(2);
    expect(topics[0].signals).toHaveLength(2);
    expect(topics[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(topics[0].lastSeen).toBe('2026-01-02T00:00:00Z');
  });

  it('should separate signals with different subsystems into different topics', () => {
    const s1 = makeSignal({ subsystem: 'parser' });
    const s2 = makeSignal({ subsystem: 'renderer' });
    const topics = aggregator.aggregate([s1, s2]);
    expect(topics).toHaveLength(2);
  });

  it('should separate signals with different failureModes into different topics', () => {
    const s1 = makeSignal({ failureMode: 'timeout' });
    const s2 = makeSignal({ failureMode: 'crash' });
    const topics = aggregator.aggregate([s1, s2]);
    expect(topics).toHaveLength(2);
  });

  it('should separate signals with different impactScopes into different topics', () => {
    const s1 = makeSignal({ impactScope: 'global' });
    const s2 = makeSignal({ impactScope: 'local' });
    const topics = aggregator.aggregate([s1, s2]);
    expect(topics).toHaveLength(2);
  });

  it('should track unique affected issues', () => {
    const s1 = makeSignal({ issueNumber: 1 });
    const s2 = makeSignal({ issueNumber: 2 });
    const s3 = makeSignal({ issueNumber: 1 }); // duplicate
    const topics = aggregator.aggregate([s1, s2, s3]);

    expect(topics).toHaveLength(1);
    expect(topics[0].affectedIssues).toEqual([1, 2]);
  });

  it('should not add undefined issueNumbers to affectedIssues', () => {
    const s1 = makeSignal({ issueNumber: undefined });
    const s2 = makeSignal({ issueNumber: 5 });
    const topics = aggregator.aggregate([s1, s2]);

    expect(topics).toHaveLength(1);
    expect(topics[0].affectedIssues).toEqual([5]);
  });

  it('should use the first signal severity when creating a topic', () => {
    const s1 = makeSignal({ severity: 'critical' });
    const topics = aggregator.aggregate([s1]);
    expect(topics[0].severity).toBe('critical');
  });

  it('should default severity to medium when signal has no severity', () => {
    const s1 = makeSignal({ severity: undefined });
    const topics = aggregator.aggregate([s1]);
    expect(topics[0].severity).toBe('medium');
  });

  it('should track firstSeen and lastSeen correctly with out-of-order timestamps', () => {
    const s1 = makeSignal({ timestamp: '2026-01-03T00:00:00Z' });
    const s2 = makeSignal({ timestamp: '2026-01-01T00:00:00Z' });
    const s3 = makeSignal({ timestamp: '2026-01-05T00:00:00Z' });
    const topics = aggregator.aggregate([s1, s2, s3]);

    expect(topics[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(topics[0].lastSeen).toBe('2026-01-05T00:00:00Z');
  });
});
