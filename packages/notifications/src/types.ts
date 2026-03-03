import type { RuntimeEvent } from '@cadre/observability';

export type NotificationEvent = RuntimeEvent;

export interface NotificationProvider {
  notify(event: NotificationEvent): Promise<void>;
}

export interface WebhookProviderConfig {
  type: 'webhook';
  url?: string;
  webhookUrl?: string;
  events?: string[];
}

export interface SlackProviderConfig {
  type: 'slack';
  webhookUrl?: string;
  url?: string;
  channel?: string;
  events?: string[];
}

export interface LogProviderConfig {
  type: 'log';
  logFile?: string;
  events?: string[];
}

export type NotificationProviderConfig =
  | WebhookProviderConfig
  | SlackProviderConfig
  | LogProviderConfig;

export type ExtensibleNotificationProviderConfig =
  | NotificationProviderConfig
  | ({ type: string } & Record<string, unknown>);

export interface NotificationsConfig {
  enabled: boolean;
  providers: ExtensibleNotificationProviderConfig[];
}

export interface NotificationProviderFactoryContext {
  stateDir?: string;
}

export type NotificationProviderFactory = (
  config: ExtensibleNotificationProviderConfig,
  context: NotificationProviderFactoryContext,
) => NotificationProvider;
