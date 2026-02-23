import type { CadreEvent } from '../logging/events.js';
import type { NotificationProvider } from './types.js';

interface WebhookConfig {
  url: string;
  events?: string[];
}

export class WebhookProvider implements NotificationProvider {
  private readonly config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  async notify(event: CadreEvent): Promise<void> {
    if (this.config.events && !this.config.events.includes(event.type)) {
      return;
    }

    const url = this.config.url.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        process.stderr.write(`WebhookProvider: HTTP ${response.status} from ${url}\n`);
      }
    } catch (err) {
      process.stderr.write(`WebhookProvider: fetch error: ${err}\n`);
    }
  }
}
