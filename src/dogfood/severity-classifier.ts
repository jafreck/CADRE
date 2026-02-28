import type { DogfoodTopic, SeverityLevel } from './types.js';

export const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  critical: 5,
  severe: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Assigns severity levels to topics and provides filtering/capping utilities.
 */
export class SeverityClassifier {
  /**
   * Classify a topic's severity based on its signals' severity, frequency, and breadth.
   */
  classify(topic: DogfoodTopic): SeverityLevel {
    // Use the highest severity among the topic's signals
    let maxLevel: SeverityLevel = 'low';
    for (const signal of topic.signals) {
      const level = signal.severity ?? 'medium';
      if (SEVERITY_ORDER[level] > SEVERITY_ORDER[maxLevel]) {
        maxLevel = level;
      }
    }

    // Escalate based on frequency and breadth
    if (topic.mergedCount >= 10 && SEVERITY_ORDER[maxLevel] < SEVERITY_ORDER['high']) {
      maxLevel = 'high';
    }
    if (topic.affectedIssues.length >= 5 && SEVERITY_ORDER[maxLevel] < SEVERITY_ORDER['severe']) {
      maxLevel = 'severe';
    }

    return maxLevel;
  }

  /**
   * Filter topics to only those at or above the minimum severity level.
   */
  filterByMinimumLevel(topics: DogfoodTopic[], minimumLevel: SeverityLevel): DogfoodTopic[] {
    const minRank = SEVERITY_ORDER[minimumLevel];
    return topics.filter((topic) => {
      const rank = SEVERITY_ORDER[topic.severity];
      return rank >= minRank;
    });
  }

  /**
   * Rank topics by severity, frequency, and breadth, then return the top N.
   */
  applyMaxCap(topics: DogfoodTopic[], maxIssuesPerRun: number): DogfoodTopic[] {
    const ranked = [...topics].sort((a, b) => {
      // Primary: severity (descending)
      const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // Secondary: frequency (descending)
      const freqDiff = b.mergedCount - a.mergedCount;
      if (freqDiff !== 0) return freqDiff;

      // Tertiary: breadth — number of affected issues (descending)
      return b.affectedIssues.length - a.affectedIssues.length;
    });

    const kept = ranked.slice(0, maxIssuesPerRun);

    return kept;
  }
}
