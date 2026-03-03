import { isAbsolute, join } from 'node:path';
import type { CadreEvent } from '@cadre/observability';
import type { NotificationsConfig } from '../config/schema.js';
import type { RuntimeConfig } from '../config/loader.js';
import type { NotificationProvider } from './types.js';
import { WebhookProvider } from './webhook-provider.js';
import { SlackProvider } from './slack-provider.js';
import { LogProvider } from './log-provider.js';

export type NotificationProviderFactoryConfig = { type: string } & Record<string, unknown>;
export type NotificationProviderFactory = (
  config: NotificationProviderFactoryConfig,
  context: { stateDir?: string },
) => NotificationProvider;

const providerFactories = new Map<string, NotificationProviderFactory>();

function normalizeProviderType(type: string): string {
  return type.trim().toLowerCase();
}

function ensureDefaultProviderFactoriesRegistered(): void {
  if (providerFactories.size > 0) {
    return;
  }

  registerNotificationProviderFactory('webhook', (providerConfig) => {
    const config = providerConfig as { url?: string; webhookUrl?: string; events?: string[] };
    return new WebhookProvider({ url: config.url ?? config.webhookUrl ?? '', events: config.events });
  });

  registerNotificationProviderFactory('slack', (providerConfig) => {
    const config = providerConfig as { webhookUrl?: string; url?: string; channel?: string; events?: string[] };
    return new SlackProvider({
      webhookUrl: config.webhookUrl ?? config.url ?? '',
      channel: config.channel,
      events: config.events,
    });
  });

  registerNotificationProviderFactory('log', (providerConfig, context) => {
    const config = providerConfig as { logFile?: string; events?: string[] };
    return new LogProvider({
      logFile: resolveLogFilePath(config.logFile, context.stateDir),
      events: config.events,
    });
  });
}

export function registerNotificationProviderFactory(type: string, factory: NotificationProviderFactory): void {
  providerFactories.set(normalizeProviderType(type), factory);
}

export function unregisterNotificationProviderFactory(type: string): void {
  providerFactories.delete(normalizeProviderType(type));
}

export function hasNotificationProviderFactory(type: string): boolean {
  ensureDefaultProviderFactoriesRegistered();
  return providerFactories.has(normalizeProviderType(type));
}

export function listNotificationProviderFactories(): string[] {
  ensureDefaultProviderFactoriesRegistered();
  return [...providerFactories.keys()].sort();
}

export function resetNotificationProviderFactories(): void {
  providerFactories.clear();
  ensureDefaultProviderFactoriesRegistered();
}

function resolveLogFilePath(logFile: string | undefined, stateDir: string | undefined): string | undefined {
  if (!logFile) {
    return stateDir ? join(stateDir, 'notifications.jsonl') : undefined;
  }
  if (isAbsolute(logFile)) {
    return logFile;
  }
  if (!stateDir) {
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
    ensureDefaultProviderFactoriesRegistered();
    this.providers = config.providers.map((providerConfig) => {
      const factory = providerFactories.get(normalizeProviderType(providerConfig.type));
      if (!factory) {
        throw new Error(
          `Unknown notification provider type "${providerConfig.type}". Registered provider types: ${listNotificationProviderFactories().join(', ') || '(none)'}.`,
        );
      }
      return factory(providerConfig as NotificationProviderFactoryConfig, { stateDir });
    });
  }

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
