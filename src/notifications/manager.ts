import type { CadreEvent } from '../logging/events.js';
import type { CadreConfig, NotificationsConfig } from '../config/schema.js';
import type { NotificationProvider } from './types.js';
import { WebhookProvider } from './webhook-provider.js';
import { SlackProvider } from './slack-provider.js';
import { LogProvider } from './log-provider.js';

export class NotificationManager {
  private readonly providers: NotificationProvider[];
  private enabled: boolean;

  constructor(config?: NotificationsConfig) {
    if (!config || !config.enabled) {
      this.enabled = false;
      this.providers = [];
      return;
    }

    this.enabled = true;
    this.providers = config.providers.map((p) => {
      switch (p.type) {
        case 'webhook':
          return new WebhookProvider({ url: p.url ?? p.webhookUrl ?? '', events: p.events });
        case 'slack':
          return new SlackProvider({ webhookUrl: p.webhookUrl ?? p.url ?? '', channel: p.channel, events: p.events });
        case 'log':
          return new LogProvider({ logFile: p.logFile, events: p.events });
      }
    });
  }

  /**
   * Register an additional notification provider at runtime.
   * Automatically enables dispatching if it was previously disabled.
   */
  addProvider(provider: NotificationProvider): void {
    this.providers.push(provider);
    this.enabled = true;
  }

  async dispatch(event: CadreEvent): Promise<void> {
    if (!this.enabled || this.providers.length === 0) {
      return;
    }

    await Promise.allSettled(this.providers.map((provider) => provider.notify(event)));
  }
}

export function createNotificationManager(config: CadreConfig): NotificationManager {
  return new NotificationManager(config.notifications);
}
