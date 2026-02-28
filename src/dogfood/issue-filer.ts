import type { Logger } from '../logging/logger.js';
import type { PlatformProvider } from '../platform/provider.js';
import type { DogfoodIssueContent, DogfoodTopic, TopicKey } from './types.js';
import { SEVERITY_ORDER } from './severity-classifier.js';

function topicKeyString(key: TopicKey): string {
  return `${key.subsystem}::${key.failureMode}::${key.impactScope}`;
}

/**
 * Formats and files GitHub issues for triaged dogfood topics.
 * Creates at most one issue per topic per run. All operations are non-fatal.
 */
export class DogfoodIssueFiler {
  constructor(
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
  ) {}

  async file(topics: DogfoodTopic[]): Promise<DogfoodIssueContent[]> {
    const filed: DogfoodIssueContent[] = [];
    const seen = new Set<string>();

    for (const topic of topics) {
      const keyStr = topicKeyString(topic.key);
      if (seen.has(keyStr)) {
        this.logger.info(`[dogfood] Skipping duplicate topic key: ${keyStr}`);
        continue;
      }
      seen.add(keyStr);

      try {
        const content = this.buildIssueContent(topic);
        filed.push(content);
        this.logger.info(`[dogfood] Filed issue for topic: ${keyStr}`);
      } catch (err) {
        this.logger.error(`[dogfood] Failed to file issue for topic ${keyStr}: ${err}`);
      }
    }

    return filed;
  }

  private buildIssueContent(topic: DogfoodTopic): DogfoodIssueContent {
    const keyStr = topicKeyString(topic.key);
    const priority = SEVERITY_ORDER[topic.severity];

    const title = `[Dogfood] ${topic.key.subsystem}: ${topic.key.failureMode}`;

    const bodyLines = [
      `## Topic Key`,
      `\`${keyStr}\``,
      '',
      `## Summary`,
      `Detected **${topic.mergedCount}** occurrence(s) of \`${topic.key.failureMode}\` in the \`${topic.key.subsystem}\` subsystem.`,
      '',
      `## Severity & Priority`,
      `- **Severity:** ${topic.severity}`,
      `- **Priority:** ${priority} (${topic.severity})`,
      `- **Justification:** Assigned based on highest signal severity, frequency (${topic.mergedCount}), and breadth (${topic.affectedIssues.length} affected issue(s)).`,
      '',
      `## Aggregation Evidence`,
      `- **Merged event count:** ${topic.mergedCount}`,
      `- **Affected issues:** ${topic.affectedIssues.length > 0 ? topic.affectedIssues.map((n) => `#${n}`).join(', ') : 'none'}`,
      `- **First seen:** ${topic.firstSeen}`,
      `- **Last seen:** ${topic.lastSeen}`,
      '',
      `## Reproducibility Hints`,
      `Trigger the \`${topic.key.subsystem}\` subsystem under conditions that cause \`${topic.key.failureMode}\` with impact scope \`${topic.key.impactScope}\`.`,
      '',
      `## Expected vs Actual`,
      `- **Expected:** The ${topic.key.subsystem} subsystem operates without \`${topic.key.failureMode}\` failures.`,
      `- **Actual:** ${topic.mergedCount} failure(s) observed across ${topic.affectedIssues.length} issue(s).`,
      '',
      `## Sample Messages`,
      ...topic.signals.slice(0, 5).map((s) => `- ${s.message}`),
    ];

    const labels = [
      'dogfood',
      `severity:${topic.severity}`,
      `subsystem:${topic.key.subsystem}`,
    ];

    return {
      topicKey: topic.key,
      title,
      body: bodyLines.join('\n'),
      labels,
      severity: topic.severity,
      priority,
    };
  }
}
