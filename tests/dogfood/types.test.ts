import { describe, it, expect } from 'vitest';
import type {
  SeverityLevel,
  DogfoodSignal,
  TopicKey,
  DogfoodTopic,
  TriageResult,
  DogfoodIssueContent,
} from '../../src/dogfood/types.js';

describe('Dogfood types', () => {
  it('should allow valid SeverityLevel values', () => {
    const levels: SeverityLevel[] = ['critical', 'severe', 'high', 'medium', 'low'];
    expect(levels).toHaveLength(5);
  });

  it('should allow constructing a valid DogfoodSignal', () => {
    const signal: DogfoodSignal = {
      subsystem: 'parser',
      failureMode: 'timeout',
      message: 'request timed out',
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(signal.subsystem).toBe('parser');
    expect(signal.issueNumber).toBeUndefined();
    expect(signal.severity).toBeUndefined();
    expect(signal.impactScope).toBeUndefined();
  });

  it('should allow constructing a DogfoodSignal with all optional fields', () => {
    const signal: DogfoodSignal = {
      subsystem: 'parser',
      failureMode: 'timeout',
      message: 'request timed out',
      timestamp: '2026-01-01T00:00:00Z',
      issueNumber: 42,
      severity: 'high',
      impactScope: 'global',
    };
    expect(signal.issueNumber).toBe(42);
    expect(signal.severity).toBe('high');
    expect(signal.impactScope).toBe('global');
  });

  it('should allow constructing a valid TopicKey', () => {
    const key: TopicKey = {
      subsystem: 'parser',
      failureMode: 'timeout',
      impactScope: 'global',
    };
    expect(key.subsystem).toBe('parser');
  });

  it('should allow constructing a valid DogfoodTopic', () => {
    const topic: DogfoodTopic = {
      key: { subsystem: 'parser', failureMode: 'timeout', impactScope: 'global' },
      signals: [],
      severity: 'high',
      mergedCount: 0,
      affectedIssues: [],
      firstSeen: '2026-01-01T00:00:00Z',
      lastSeen: '2026-01-01T00:00:00Z',
    };
    expect(topic.severity).toBe('high');
  });

  it('should allow constructing a valid TriageResult', () => {
    const result: TriageResult = {
      topics: [],
      filed: [],
      skippedBelowThreshold: [],
      skippedOverCap: [],
    };
    expect(result.topics).toEqual([]);
  });

  it('should allow constructing a valid DogfoodIssueContent', () => {
    const content: DogfoodIssueContent = {
      topicKey: { subsystem: 'parser', failureMode: 'timeout', impactScope: 'global' },
      title: 'Test',
      body: 'Body',
      labels: ['dogfood'],
      severity: 'high',
      priority: 3,
    };
    expect(content.labels).toContain('dogfood');
  });
});
