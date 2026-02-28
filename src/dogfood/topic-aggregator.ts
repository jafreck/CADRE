import type { DogfoodSignal, DogfoodTopic, TopicKey } from './types.js';

/**
 * Clusters signals into topics by building a stable topic key
 * from subsystem, failure mode, and impact scope.
 */
export class TopicAggregator {
  private buildKey(signal: DogfoodSignal): string {
    return `${signal.subsystem}::${signal.failureMode}::${signal.impactScope ?? 'unknown'}`;
  }

  private buildTopicKey(signal: DogfoodSignal): TopicKey {
    return {
      subsystem: signal.subsystem,
      failureMode: signal.failureMode,
      impactScope: signal.impactScope ?? 'unknown',
    };
  }

  aggregate(signals: DogfoodSignal[]): DogfoodTopic[] {
    const topicMap = new Map<string, DogfoodTopic>();

    for (const signal of signals) {
      const keyStr = this.buildKey(signal);

      const existing = topicMap.get(keyStr);
      if (existing) {
        existing.signals.push(signal);
        existing.mergedCount++;
        if (signal.issueNumber != null && !existing.affectedIssues.includes(signal.issueNumber)) {
          existing.affectedIssues.push(signal.issueNumber);
        }
        if (signal.timestamp < existing.firstSeen) {
          existing.firstSeen = signal.timestamp;
        }
        if (signal.timestamp > existing.lastSeen) {
          existing.lastSeen = signal.timestamp;
        }
      } else {
        topicMap.set(keyStr, {
          key: this.buildTopicKey(signal),
          signals: [signal],
          severity: signal.severity ?? 'medium',
          mergedCount: 1,
          affectedIssues: signal.issueNumber != null ? [signal.issueNumber] : [],
          firstSeen: signal.timestamp,
          lastSeen: signal.timestamp,
        });
      }
    }

    return Array.from(topicMap.values());
  }
}
