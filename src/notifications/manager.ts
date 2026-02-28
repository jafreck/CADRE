import { isAbsolute, join } from 'node:path';
import type { CadreEvent } from '../logging/events.js';
import type { NotificationsConfig } from '../config/schema.js';
import type { RuntimeConfig } from '../config/loader.js';
import type { NotificationProvider } from './types.js';
import { WebhookProvider } from './webhook-provider.js';
import { SlackProvider } from './slack-provider.js';
import { LogProvider } from './log-provider.js';

function resolveLogFilePath(logFile: string | undefined, stateDir: string | undefined): string | undefined {
  if (!logFile) {
    return stateDir ? join(stateDir, 'notifications.jsonl') : undefined;
  }
  if (isAbsolute(logFile) || !stateDir) {
    return logFile;
  }
  if (logFile.startsWith('.cadre/')) {
    return join(stateDir, logFile.slice('.cadre/'.length));
  }
  return join(stateDir, logFile);
}

export class NotificationManager {
  private readonly providers: NotificationProvider[];
  private enabled: boolean;

  constructor(config?: NotificationsConfig, stateDir?: string) {
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
          return new LogProvider({
            logFile: resolveLogFilePath(p.logFile, stateDir),
            events: p.events,
          });
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

export function createNotificationManager(config: RuntimeConfig): NotificationManager {
  return new NotificationManager(config.notifications, config.stateDir);
}
