import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationManager } from '../../src/notifications/manager.js';
import type { NotificationProvider, NotificationEvent } from '../../src/notifications/types.js';

function makeEvent(type: string = 'test-event'): NotificationEvent {
  return { type } as NotificationEvent;
}

function makeProvider(impl?: Partial<NotificationProvider>): NotificationProvider {
  return {
    notify: impl?.notify ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe('NotificationManager', () => {
  it('does nothing when disabled', async () => {
    const mgr = new NotificationManager();
    // Should not throw
    await mgr.dispatch(makeEvent());
  });

  it('does nothing when config.enabled is false', async () => {
    const mgr = new NotificationManager({ enabled: false, providers: [] });
    await mgr.dispatch(makeEvent());
  });

  describe('with providers', () => {
    it('dispatches to all added providers', async () => {
      const mgr = new NotificationManager();
      const p1 = makeProvider();
      const p2 = makeProvider();
      mgr.addProvider(p1);
      mgr.addProvider(p2);

      const event = makeEvent('fleet-started');
      await mgr.dispatch(event);

      expect(p1.notify).toHaveBeenCalledWith(event);
      expect(p2.notify).toHaveBeenCalledWith(event);
    });
  });

  describe('error handling', () => {
    it('does not throw when a provider fails', async () => {
      const mgr = new NotificationManager();
      const failingProvider = makeProvider({
        notify: vi.fn().mockRejectedValue(new Error('network error')),
      });
      mgr.addProvider(failingProvider);

      // Should not throw
      await mgr.dispatch(makeEvent());
    });

    it('logs warnings for failed providers when logger is provided', async () => {
      const logger = { warn: vi.fn() };
      const mgr = new NotificationManager(undefined, undefined, { logger });
      const failingProvider = makeProvider({
        notify: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      mgr.addProvider(failingProvider);

      await mgr.dispatch(makeEvent());

      expect(logger.warn).toHaveBeenCalledWith(
        'Notification dispatch failed',
        expect.objectContaining({ error: 'timeout' }),
      );
    });
  });

  describe('retry logic', () => {
    it('retries failed dispatches up to maxRetries', async () => {
      const notifyFn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(undefined);

      const mgr = new NotificationManager(undefined, undefined, {
        maxRetries: 2,
        retryDelayMs: 1, // fast for testing
      });
      mgr.addProvider({ notify: notifyFn });

      await mgr.dispatch(makeEvent());

      expect(notifyFn).toHaveBeenCalledTimes(3);
    });

    it('gives up after exhausting retries', async () => {
      const logger = { warn: vi.fn() };
      const notifyFn = vi.fn().mockRejectedValue(new Error('persistent failure'));

      const mgr = new NotificationManager(undefined, undefined, {
        maxRetries: 1,
        retryDelayMs: 1,
        logger,
      });
      mgr.addProvider({ notify: notifyFn });

      await mgr.dispatch(makeEvent());

      // 1 initial + 1 retry = 2 calls
      expect(notifyFn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
