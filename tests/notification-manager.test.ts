import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationManager,
  registerNotificationProviderFactory,
  hasNotificationProviderFactory,
  resetNotificationProviderFactories,
} from '../packages/framework/src/notifications/manager.js';
import type { CadreEvent, NotificationsConfig } from '../packages/framework/src/notifications/types.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../packages/framework/src/notifications/webhook-provider.js', () => ({
  WebhookProvider: vi.fn().mockImplementation(function () {
    return { notify: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../packages/framework/src/notifications/slack-provider.js', () => ({
  SlackProvider: vi.fn().mockImplementation(function () {
    return { notify: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../packages/framework/src/notifications/log-provider.js', () => ({
  LogProvider: vi.fn().mockImplementation(function () {
    return { notify: vi.fn().mockResolvedValue(undefined) };
  }),
}));

import { WebhookProvider } from '../packages/framework/src/notifications/webhook-provider.js';
import { SlackProvider } from '../packages/framework/src/notifications/slack-provider.js';
import { LogProvider } from '../packages/framework/src/notifications/log-provider.js';

const MockWebhookProvider = WebhookProvider as unknown as ReturnType<typeof vi.fn>;
const MockSlackProvider = SlackProvider as unknown as ReturnType<typeof vi.fn>;
const MockLogProvider = LogProvider as unknown as ReturnType<typeof vi.fn>;

const sampleEvent: CadreEvent = { type: 'fleet-started', issueCount: 2, maxParallel: 2 };

function makeConfig(overrides: Partial<NotificationsConfig> = {}): NotificationsConfig {
  return {
    enabled: true,
    providers: [],
    ...overrides,
  };
}

describe('NotificationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationProviderFactories();
    MockWebhookProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
    MockSlackProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
    MockLogProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
  });

  describe('no-op when disabled or absent', () => {
    it('should be a no-op when config is undefined', async () => {
      const manager = new NotificationManager(undefined);
      await expect(manager.dispatch(sampleEvent)).resolves.toBeUndefined();
    });

    it('should be a no-op when notifications.enabled is false', async () => {
      const manager = new NotificationManager(makeConfig({ enabled: false }));
      await expect(manager.dispatch(sampleEvent)).resolves.toBeUndefined();
    });

    it('should not instantiate any providers when disabled', () => {
      new NotificationManager(makeConfig({ enabled: false }));
      expect(MockWebhookProvider).not.toHaveBeenCalled();
      expect(MockSlackProvider).not.toHaveBeenCalled();
      expect(MockLogProvider).not.toHaveBeenCalled();
    });
  });

  describe('provider instantiation', () => {
    it('exposes default provider factories', () => {
      expect(hasNotificationProviderFactory('webhook')).toBe(true);
      expect(hasNotificationProviderFactory('slack')).toBe(true);
      expect(hasNotificationProviderFactory('log')).toBe(true);
    });

    it('should instantiate WebhookProvider for type "webhook" using url', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      }));
      expect(MockWebhookProvider).toHaveBeenCalledOnce();
      expect(MockWebhookProvider).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/hook' }),
      );
    });

    it('should instantiate SlackProvider for type "slack" using url', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'slack', url: 'https://hooks.slack.com/abc' }],
      }));
      expect(MockSlackProvider).toHaveBeenCalledOnce();
      expect(MockSlackProvider).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://hooks.slack.com/abc' }),
      );
    });

    it('should pass channel to SlackProvider', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'slack', url: 'https://hooks.slack.com/abc', channel: '#alerts' }],
      }));
      expect(MockSlackProvider).toHaveBeenCalledWith(
        expect.objectContaining({ channel: '#alerts' }),
      );
    });

    it('should instantiate LogProvider for type "log"', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'log', logFile: '/tmp/cadre.jsonl' }],
      }));
      expect(MockLogProvider).toHaveBeenCalledOnce();
      expect(MockLogProvider).toHaveBeenCalledWith(
        expect.objectContaining({ logFile: '/tmp/cadre.jsonl' }),
      );
    });

    it('should instantiate multiple providers from the providers array', () => {
      new NotificationManager(makeConfig({
        providers: [
          { type: 'webhook', url: 'https://example.com/hook' },
          { type: 'slack', url: 'https://hooks.slack.com/abc' },
          { type: 'log' },
        ],
      }));
      expect(MockWebhookProvider).toHaveBeenCalledOnce();
      expect(MockSlackProvider).toHaveBeenCalledOnce();
      expect(MockLogProvider).toHaveBeenCalledOnce();
    });

    it('supports custom provider factory registration', async () => {
      const notify = vi.fn().mockResolvedValue(undefined);
      registerNotificationProviderFactory('custom', () => ({ notify }));

      const manager = new NotificationManager(makeConfig({
        providers: [{ type: 'custom' } as never],
      }));

      await manager.dispatch(sampleEvent);
      expect(notify).toHaveBeenCalledWith(sampleEvent);
    });
  });

  describe('dispatch', () => {
    it('should call notify on all providers with the event', async () => {
      const webhookNotify = vi.fn().mockResolvedValue(undefined);
      const slackNotify = vi.fn().mockResolvedValue(undefined);
      MockWebhookProvider.mockImplementation(function () {
        return { notify: webhookNotify };
      });
      MockSlackProvider.mockImplementation(function () {
        return { notify: slackNotify };
      });

      const manager = new NotificationManager(makeConfig({
        providers: [
          { type: 'webhook', url: 'https://example.com/hook' },
          { type: 'slack', url: 'https://hooks.slack.com/abc' },
        ],
      }));

      await manager.dispatch(sampleEvent);

      expect(webhookNotify).toHaveBeenCalledOnce();
      expect(webhookNotify).toHaveBeenCalledWith(sampleEvent);
      expect(slackNotify).toHaveBeenCalledOnce();
      expect(slackNotify).toHaveBeenCalledWith(sampleEvent);
    });

    it('should not throw when one provider fails', async () => {
      const failingNotify = vi.fn().mockRejectedValue(new Error('provider error'));
      const successNotify = vi.fn().mockResolvedValue(undefined);
      MockWebhookProvider.mockImplementation(function () {
        return { notify: failingNotify };
      });
      MockLogProvider.mockImplementation(function () {
        return { notify: successNotify };
      });

      const manager = new NotificationManager(makeConfig({
        providers: [
          { type: 'webhook', url: 'https://example.com/hook' },
          { type: 'log' },
        ],
      }));

      await expect(manager.dispatch(sampleEvent)).resolves.toBeUndefined();
    });

    it('should still call other providers when one fails', async () => {
      const failingNotify = vi.fn().mockRejectedValue(new Error('provider error'));
      const successNotify = vi.fn().mockResolvedValue(undefined);
      MockWebhookProvider.mockImplementation(function () {
        return { notify: failingNotify };
      });
      MockLogProvider.mockImplementation(function () {
        return { notify: successNotify };
      });

      const manager = new NotificationManager(makeConfig({
        providers: [
          { type: 'webhook', url: 'https://example.com/hook' },
          { type: 'log' },
        ],
      }));

      await manager.dispatch(sampleEvent);

      expect(successNotify).toHaveBeenCalledOnce();
      expect(successNotify).toHaveBeenCalledWith(sampleEvent);
    });

    it('should be a no-op when providers array is empty', async () => {
      const manager = new NotificationManager(makeConfig({ providers: [] }));
      await expect(manager.dispatch(sampleEvent)).resolves.toBeUndefined();
    });
  });

  describe('addProvider', () => {
    it('should enable dispatching when manager was initially disabled', async () => {
      const manager = new NotificationManager(undefined);
      const notify = vi.fn().mockResolvedValue(undefined);
      manager.addProvider({ notify });

      await manager.dispatch(sampleEvent);

      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(sampleEvent);
    });

    it('should add to existing providers when already enabled', async () => {
      const webhookNotify = vi.fn().mockResolvedValue(undefined);
      MockWebhookProvider.mockImplementation(function () {
        return { notify: webhookNotify };
      });

      const manager = new NotificationManager(makeConfig({
        providers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      }));

      const extraNotify = vi.fn().mockResolvedValue(undefined);
      manager.addProvider({ notify: extraNotify });

      await manager.dispatch(sampleEvent);

      expect(webhookNotify).toHaveBeenCalledOnce();
      expect(extraNotify).toHaveBeenCalledOnce();
    });

    it('should call added provider alongside original providers', async () => {
      const manager = new NotificationManager(makeConfig({ providers: [] }));
      const notify1 = vi.fn().mockResolvedValue(undefined);
      const notify2 = vi.fn().mockResolvedValue(undefined);
      manager.addProvider({ notify: notify1 });
      manager.addProvider({ notify: notify2 });

      await manager.dispatch(sampleEvent);

      expect(notify1).toHaveBeenCalledOnce();
      expect(notify2).toHaveBeenCalledOnce();
    });
  });
});

describe('NotificationManager runtime config integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebhookProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
    MockSlackProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
    MockLogProvider.mockImplementation(function () {
      return { notify: vi.fn().mockResolvedValue(undefined) };
    });
  });

  it('should construct a NotificationManager from runtime config values', () => {
    const config = makeRuntimeConfig({ notifications: makeConfig() });
    const manager = new NotificationManager(config.notifications, config.stateDir);
    expect(manager).toBeInstanceOf(NotificationManager);
  });

  it('should pass config.notifications to the NotificationManager', async () => {
    const webhookNotify = vi.fn().mockResolvedValue(undefined);
    MockWebhookProvider.mockImplementation(function () {
      return { notify: webhookNotify };
    });

    const config = makeRuntimeConfig({
      notifications: makeConfig({
        providers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      }),
    });

    const manager = new NotificationManager(config.notifications, config.stateDir);
    await manager.dispatch(sampleEvent);

    expect(webhookNotify).toHaveBeenCalledOnce();
    expect(webhookNotify).toHaveBeenCalledWith(sampleEvent);
  });

  it('should resolve relative logFile under stateDir', () => {
    const config = makeRuntimeConfig({
      stateDir: '/tmp/cadre-state',
      notifications: makeConfig({
        providers: [{ type: 'log', logFile: '.cadre/notifications.log' }],
      }),
    });

    new NotificationManager(config.notifications, config.stateDir);

    expect(MockLogProvider).toHaveBeenCalledWith(
      expect.objectContaining({ logFile: '/tmp/cadre-state/notifications.log' }),
    );
  });

  it('should default log provider path to stateDir when logFile is omitted', () => {
    const config = makeRuntimeConfig({
      stateDir: '/tmp/cadre-state',
      notifications: makeConfig({
        providers: [{ type: 'log' }],
      }),
    });

    new NotificationManager(config.notifications, config.stateDir);

    expect(MockLogProvider).toHaveBeenCalledWith(
      expect.objectContaining({ logFile: '/tmp/cadre-state/notifications.jsonl' }),
    );
  });
});
