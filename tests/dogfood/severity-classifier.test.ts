import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeverityClassifier, SEVERITY_ORDER } from '../../src/dogfood/severity-classifier.js';
import type { DogfoodTopic, SeverityLevel, TopicKey } from '../../src/dogfood/types.js';

function makeTopic(overrides: Partial<DogfoodTopic> = {}): DogfoodTopic {
  return {
    key: { subsystem: 'test', failureMode: 'error', impactScope: 'unknown' },
    signals: [
      {
        subsystem: 'test',
        failureMode: 'error',
        message: 'msg',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ],
    severity: 'medium',
    mergedCount: 1,
    affectedIssues: [],
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SEVERITY_ORDER', () => {
  it('should have correct ordering: critical > severe > high > medium > low', () => {
    expect(SEVERITY_ORDER['critical']).toBeGreaterThan(SEVERITY_ORDER['severe']);
    expect(SEVERITY_ORDER['severe']).toBeGreaterThan(SEVERITY_ORDER['high']);
    expect(SEVERITY_ORDER['high']).toBeGreaterThan(SEVERITY_ORDER['medium']);
    expect(SEVERITY_ORDER['medium']).toBeGreaterThan(SEVERITY_ORDER['low']);
  });
});

describe('SeverityClassifier', () => {
  let classifier: SeverityClassifier;

  beforeEach(() => {
    classifier = new SeverityClassifier();
    vi.clearAllMocks();
  });

  describe('classify', () => {
    it('should return the highest severity among signals', () => {
      const topic = makeTopic({
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'low' },
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'high' },
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'medium' },
        ],
      });
      expect(classifier.classify(topic)).toBe('high');
    });

    it('should default signal severity to medium when undefined', () => {
      const topic = makeTopic({
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't' },
        ],
      });
      expect(classifier.classify(topic)).toBe('medium');
    });

    it('should escalate to high when mergedCount >= 10 and max severity is below high', () => {
      const topic = makeTopic({
        mergedCount: 10,
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'low' },
        ],
      });
      expect(classifier.classify(topic)).toBe('high');
    });

    it('should not downgrade severity when mergedCount >= 10 but severity is already above high', () => {
      const topic = makeTopic({
        mergedCount: 10,
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'critical' },
        ],
      });
      expect(classifier.classify(topic)).toBe('critical');
    });

    it('should escalate to severe when affectedIssues >= 5 and max severity is below severe', () => {
      const topic = makeTopic({
        affectedIssues: [1, 2, 3, 4, 5],
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'low' },
        ],
      });
      expect(classifier.classify(topic)).toBe('severe');
    });

    it('should not downgrade from critical when affectedIssues >= 5', () => {
      const topic = makeTopic({
        affectedIssues: [1, 2, 3, 4, 5],
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'critical' },
        ],
      });
      expect(classifier.classify(topic)).toBe('critical');
    });

    it('should apply both escalation rules when both thresholds are met', () => {
      const topic = makeTopic({
        mergedCount: 15,
        affectedIssues: [1, 2, 3, 4, 5],
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'm', timestamp: 't', severity: 'low' },
        ],
      });
      expect(classifier.classify(topic)).toBe('severe');
    });
  });

  describe('filterByMinimumLevel', () => {
    it('should keep topics at or above the minimum level', () => {
      const topics = [
        makeTopic({ severity: 'critical' }),
        makeTopic({ severity: 'high' }),
        makeTopic({ severity: 'low' }),
      ];
      const result = classifier.filterByMinimumLevel(topics, 'high');
      expect(result).toHaveLength(2);
      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('high');
    });

    it('should filter out topics below threshold', () => {
      const topics = [makeTopic({ severity: 'low' })];
      const result = classifier.filterByMinimumLevel(topics, 'high');
      expect(result).toHaveLength(0);
    });

    it('should return all topics when minimum level is low', () => {
      const topics = [
        makeTopic({ severity: 'low' }),
        makeTopic({ severity: 'critical' }),
      ];
      const result = classifier.filterByMinimumLevel(topics, 'low');
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no topics meet the threshold', () => {
      const topics = [makeTopic({ severity: 'low' }), makeTopic({ severity: 'medium' })];
      const result = classifier.filterByMinimumLevel(topics, 'critical');
      expect(result).toEqual([]);
    });
  });

  describe('applyMaxCap', () => {
    it('should return all topics when under the cap', () => {
      const topics = [makeTopic(), makeTopic()];
      const result = classifier.applyMaxCap(topics, 5);
      expect(result).toHaveLength(2);
    });

    it('should cap to maxIssuesPerRun topics', () => {
      const topics = [
        makeTopic({ severity: 'critical', mergedCount: 5 }),
        makeTopic({ severity: 'high', mergedCount: 3 }),
        makeTopic({ severity: 'low', mergedCount: 1 }),
      ];
      const result = classifier.applyMaxCap(topics, 2);
      expect(result).toHaveLength(2);
      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('high');
    });

    it('should rank by severity first, then frequency, then breadth', () => {
      const topics = [
        makeTopic({ severity: 'medium', mergedCount: 100, affectedIssues: [] }),
        makeTopic({ severity: 'high', mergedCount: 1, affectedIssues: [] }),
        makeTopic({ severity: 'high', mergedCount: 5, affectedIssues: [1, 2] }),
        makeTopic({ severity: 'high', mergedCount: 5, affectedIssues: [1] }),
      ];
      const result = classifier.applyMaxCap(topics, 4);
      expect(result[0].severity).toBe('high');
      expect(result[0].mergedCount).toBe(5);
      expect(result[0].affectedIssues).toEqual([1, 2]);
      expect(result[1].severity).toBe('high');
      expect(result[1].mergedCount).toBe(5);
      expect(result[1].affectedIssues).toEqual([1]);
      expect(result[2].severity).toBe('high');
      expect(result[2].mergedCount).toBe(1);
      expect(result[3].severity).toBe('medium');
    });

    it('should drop topics over the cap', () => {
      const topics = [makeTopic(), makeTopic()];
      const result = classifier.applyMaxCap(topics, 1);
      expect(result).toHaveLength(1);
    });

    it('should return empty array when cap is 0', () => {
      const topics = [makeTopic()];
      const result = classifier.applyMaxCap(topics, 0);
      expect(result).toEqual([]);
    });
  });
});
