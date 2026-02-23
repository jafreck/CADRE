import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationManager, createNotificationManager } from '../src/notifications/manager.js';
import type { CadreEvent } from '../src/notifications/types.js';
import type { CadreConfig, NotificationsConfig } from '../src/config/schema.js';

vi.mock('../src/notifications/webhook-provider.js', () => ({
  WebhookProvider: vi.fn().mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../src/notifications/slack-provider.js', () => ({
  SlackProvider: vi.fn().mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../src/notifications/log-provider.js', () => ({
  LogProvider: vi.fn().mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) })),
}));

import { WebhookProvider } from '../src/notifications/webhook-provider.js';
import { SlackProvider } from '../src/notifications/slack-provider.js';
import { LogProvider } from '../src/notifications/log-provider.js';

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
    MockWebhookProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
    MockSlackProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
    MockLogProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
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
    it('should instantiate WebhookProvider for type "webhook" using url', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      }));
      expect(MockWebhookProvider).toHaveBeenCalledOnce();
      expect(MockWebhookProvider).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/hook' }),
      );
    });

    it('should fall back to webhookUrl for webhook provider when url is absent', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'webhook', webhookUrl: 'https://fallback.example.com/hook' }],
      }));
      expect(MockWebhookProvider).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://fallback.example.com/hook' }),
      );
    });

    it('should instantiate SlackProvider for type "slack" using webhookUrl', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'slack', webhookUrl: 'https://hooks.slack.com/abc' }],
      }));
      expect(MockSlackProvider).toHaveBeenCalledOnce();
      expect(MockSlackProvider).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://hooks.slack.com/abc' }),
      );
    });

    it('should fall back to url for slack provider when webhookUrl is absent', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'slack', url: 'https://hooks.slack.com/fallback' }],
      }));
      expect(MockSlackProvider).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://hooks.slack.com/fallback' }),
      );
    });

    it('should pass channel to SlackProvider', () => {
      new NotificationManager(makeConfig({
        providers: [{ type: 'slack', webhookUrl: 'https://hooks.slack.com/abc', channel: '#alerts' }],
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
          { type: 'slack', webhookUrl: 'https://hooks.slack.com/abc' },
          { type: 'log' },
        ],
      }));
      expect(MockWebhookProvider).toHaveBeenCalledOnce();
      expect(MockSlackProvider).toHaveBeenCalledOnce();
      expect(MockLogProvider).toHaveBeenCalledOnce();
    });
  });

  describe('dispatch', () => {
    it('should call notify on all providers with the event', async () => {
      const webhookNotify = vi.fn().mockResolvedValue(undefined);
      const slackNotify = vi.fn().mockResolvedValue(undefined);
      MockWebhookProvider.mockImplementation(() => ({ notify: webhookNotify }));
      MockSlackProvider.mockImplementation(() => ({ notify: slackNotify }));

      const manager = new NotificationManager(makeConfig({
        providers: [
          { type: 'webhook', url: 'https://example.com/hook' },
          { type: 'slack', webhookUrl: 'https://hooks.slack.com/abc' },
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
      MockWebhookProvider.mockImplementation(() => ({ notify: failingNotify }));
      MockLogProvider.mockImplementation(() => ({ notify: successNotify }));

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
      MockWebhookProvider.mockImplementation(() => ({ notify: failingNotify }));
      MockLogProvider.mockImplementation(() => ({ notify: successNotify }));

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
});

describe('createNotificationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebhookProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
    MockSlackProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
    MockLogProvider.mockImplementation(() => ({ notify: vi.fn().mockResolvedValue(undefined) }));
  });

  it('should return a NotificationManager instance', () => {
    const config = { notifications: makeConfig() } as unknown as CadreConfig;
    const manager = createNotificationManager(config);
    expect(manager).toBeInstanceOf(NotificationManager);
  });

  it('should pass config.notifications to the NotificationManager', async () => {
    const webhookNotify = vi.fn().mockResolvedValue(undefined);
    MockWebhookProvider.mockImplementation(() => ({ notify: webhookNotify }));

    const config = {
      notifications: makeConfig({
        providers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      }),
    } as unknown as CadreConfig;

    const manager = createNotificationManager(config);
    await manager.dispatch(sampleEvent);

    expect(webhookNotify).toHaveBeenCalledOnce();
    expect(webhookNotify).toHaveBeenCalledWith(sampleEvent);
  });
});
