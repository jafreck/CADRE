import { isAbsolute, join } from 'node:path';
import type {
  NotificationEvent,
  NotificationProvider,
  NotificationsConfig,
  NotificationProviderFactory,
  ExtensibleNotificationProviderConfig,
} from './types.js';
import { WebhookProvider } from './webhook-provider.js';
import { SlackProvider } from './slack-provider.js';
import { LogProvider } from './log-provider.js';

const providerFactories = new Map<string, NotificationProviderFactory>();

function normalizeProviderName(type: string): string {
  return type.trim().toLowerCase();
}

function ensureDefaultProviderFactoriesRegistered(): void {
  if (providerFactories.size > 0) {
    return;
  }

  registerNotificationProviderFactory('webhook', (config) => {
    const webhookConfig = config as { url?: string; webhookUrl?: string; events?: string[] };
    return new WebhookProvider({
      url: webhookConfig.url ?? webhookConfig.webhookUrl ?? '',
      events: webhookConfig.events,
    });
  });

  registerNotificationProviderFactory('slack', (config) => {
    const slackConfig = config as { webhookUrl?: string; url?: string; channel?: string; events?: string[] };
    return new SlackProvider({
      webhookUrl: slackConfig.webhookUrl ?? slackConfig.url ?? '',
      channel: slackConfig.channel,
      events: slackConfig.events,
    });
  });

  registerNotificationProviderFactory('log', (config, context) => {
    const logConfig = config as { logFile?: string; events?: string[] };
    return new LogProvider({
      logFile: resolveLogFilePath(logConfig.logFile, context.stateDir),
      events: logConfig.events,
    });
  });
}

function createProviderFromConfig(
  config: ExtensibleNotificationProviderConfig,
  stateDir: string | undefined,
): NotificationProvider {
  ensureDefaultProviderFactoriesRegistered();
  const providerType = normalizeProviderName(config.type);
  const factory = providerFactories.get(providerType);
  if (!factory) {
    throw new Error(
      `Unknown notification provider type "${config.type}". Registered provider types: ${listNotificationProviderFactories().join(', ') || '(none)'}.`,
    );
  }
  return factory(config, { stateDir });
}

export function registerNotificationProviderFactory(type: string, factory: NotificationProviderFactory): void {
  providerFactories.set(normalizeProviderName(type), factory);
}

export function unregisterNotificationProviderFactory(type: string): void {
  providerFactories.delete(normalizeProviderName(type));
}

export function hasNotificationProviderFactory(type: string): boolean {
  ensureDefaultProviderFactoriesRegistered();
  return providerFactories.has(normalizeProviderName(type));
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

export interface NotificationManagerOptions {
  /** Maximum number of retries for transient failures per provider. Defaults to 0. */
  maxRetries?: number;
  /** Base delay in ms between retries. Defaults to 1000. */
  retryDelayMs?: number;
  /** Optional logger for dispatch errors. When absent errors are silently swallowed. */
  logger?: { warn(message: string, context?: Record<string, unknown>): void };
}

export class NotificationManager {
  private readonly providers: NotificationProvider[];
  private enabled: boolean;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly logger?: { warn(message: string, context?: Record<string, unknown>): void };

  constructor(config?: NotificationsConfig, stateDir?: string, options?: NotificationManagerOptions) {
    this.maxRetries = options?.maxRetries ?? 0;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.logger = options?.logger;

    if (!config || !config.enabled) {
      this.enabled = false;
      this.providers = [];
      return;
    }

    this.enabled = true;
    this.providers = config.providers.map((providerConfig) =>
      createProviderFromConfig(providerConfig, stateDir),
    );
  }

  addProvider(provider: NotificationProvider): void {
    this.providers.push(provider);
    this.enabled = true;
  }

  async dispatch(event: NotificationEvent): Promise<void> {
    if (!this.enabled || this.providers.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      this.providers.map((provider) => this.dispatchWithRetry(provider, event)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger?.warn('Notification dispatch failed', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          event: event.type,
        });
      }
    }
  }

  private async dispatchWithRetry(provider: NotificationProvider, event: NotificationEvent): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await provider.notify(event);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }
}
