import type { NotificationProvider } from './types.js';
import type { CadreEvent } from '../logging/events.js';

export interface SlackProviderConfig {
  webhookUrl: string;
  channel?: string;
  events?: string[];
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

function buildBlocks(event: CadreEvent): object[] {
  const blocks: object[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: event.type,
        emoji: true,
      },
    },
  ];

  const fields = Object.entries(event)
    .filter(([key]) => key !== 'type')
    .map(([key, val]) => `*${key}:* ${String(val)}`)
    .join('\n');

  if (fields) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: fields,
      },
    });
  }

  return blocks;
}

export class SlackProvider implements NotificationProvider {
  private readonly config: SlackProviderConfig;

  constructor(config: SlackProviderConfig) {
    this.config = config;
  }

  async notify(event: CadreEvent): Promise<void> {
    if (this.config.events && !this.config.events.includes(event.type)) {
      return;
    }

    const webhookUrl = resolveEnvVars(this.config.webhookUrl);
    const payload: Record<string, unknown> = {
      blocks: buildBlocks(event),
    };
    if (this.config.channel) {
      payload['channel'] = this.config.channel;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error(`[SlackProvider] HTTP ${response.status} posting to Slack webhook`);
      }
    } catch (err) {
      console.error('[SlackProvider] Failed to post notification:', err);
    }
  }
}
