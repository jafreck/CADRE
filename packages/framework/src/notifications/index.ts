// @cadre/framework/notifications — notification dispatch framework

export type {
  NotificationEvent,
  FrameworkNotificationEvent,
  CadreSemanticNotificationEvent,
  CadreNotificationEvent,
  CadreEvent,
  NotificationProvider,
  NotificationProviderFactory,
  NotificationProviderFactoryContext,
  NotificationsConfig,
  NotificationProviderConfig,
  ExtensibleNotificationProviderConfig,
  WebhookProviderConfig,
  SlackProviderConfig,
  LogProviderConfig,
} from './types.js';

export {
  NotificationManager,
  registerNotificationProviderFactory,
  unregisterNotificationProviderFactory,
  hasNotificationProviderFactory,
  listNotificationProviderFactories,
  resetNotificationProviderFactories,
} from './manager.js';
export { WebhookProvider } from './webhook-provider.js';
export { SlackProvider } from './slack-provider.js';
export { LogProvider } from './log-provider.js';
