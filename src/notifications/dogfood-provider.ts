import type { CadreEvent } from '../logging/events.js';
import type { NotificationProvider } from './types.js';
import type { GitHubAPI } from '../github/api.js';

export interface DogfoodConfig {
  maxIssuesPerRun: number;
  labels: string[];
  titlePrefix: string;
}

export class DogfoodProvider implements NotificationProvider {
  private readonly seen = new Set<string>();
  private issuesCreated = 0;

  constructor(
    private readonly github: GitHubAPI,
    private readonly config: DogfoodConfig,
  ) {}

  async notify(event: CadreEvent): Promise<void> {
    if (this.issuesCreated >= this.config.maxIssuesPerRun) {
      return;
    }

    const dedupeKey = `${event.type}:${JSON.stringify(event)}`;
    if (this.seen.has(dedupeKey)) {
      return;
    }
    this.seen.add(dedupeKey);

    const title = `${this.config.titlePrefix} ${event.type}`;
    const body = [
      `## Event: \`${event.type}\``,
      '',
      `**Timestamp:** ${new Date().toISOString()}`,
      '',
      '### Payload',
      '',
      '```json',
      JSON.stringify(event, null, 2),
      '```',
    ].join('\n');

    try {
      await this.github.createIssue({
        title,
        body,
        labels: this.config.labels,
      });
      this.issuesCreated++;
    } catch (err) {
      console.error(`DogfoodProvider: failed to create issue: ${err}`);
    }
  }
}
