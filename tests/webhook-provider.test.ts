import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookProvider } from '../src/notifications/webhook-provider.js';
import type { CadreEvent } from '../src/notifications/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

function makeErrorResponse(status: number): Response {
  return { ok: false, status } as Response;
}

const sampleEvent: CadreEvent = { type: 'fleet-started', issueCount: 2, maxParallel: 2 };

describe('WebhookProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(makeOkResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('happy path', () => {
    it('should POST JSON payload to the configured URL', async () => {
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      await provider.notify(sampleEvent);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/hook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleEvent),
      });
    });

    it('should resolve ${ENV_VAR} placeholders in url from process.env', async () => {
      vi.stubEnv('WEBHOOK_HOST', 'hooks.example.com');
      vi.stubEnv('WEBHOOK_PATH', 'my-hook');

      const provider = new WebhookProvider({ url: 'https://${WEBHOOK_HOST}/${WEBHOOK_PATH}' });
      await provider.notify(sampleEvent);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.example.com/my-hook',
        expect.any(Object),
      );
    });

    it('should replace unknown ENV_VAR placeholders with empty string', async () => {
      delete process.env.UNKNOWN_VAR;
      const provider = new WebhookProvider({ url: 'https://example.com/${UNKNOWN_VAR}/hook' });
      await provider.notify(sampleEvent);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com//hook',
        expect.any(Object),
      );
    });
  });

  describe('events filter', () => {
    it('should call fetch when event type matches events filter', async () => {
      const provider = new WebhookProvider({
        url: 'https://example.com/hook',
        events: ['fleet-started', 'fleet-completed'],
      });
      await provider.notify(sampleEvent);

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should skip fetch when event type is not in events filter', async () => {
      const provider = new WebhookProvider({
        url: 'https://example.com/hook',
        events: ['issue-completed', 'issue-failed'],
      });
      await provider.notify(sampleEvent);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not skip any events when events filter is not provided', async () => {
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      const events: CadreEvent[] = [
        { type: 'fleet-started', issueCount: 1, maxParallel: 1 },
        { type: 'fleet-completed', success: true, prsCreated: 1, failedIssues: 0, totalDuration: 10, totalTokens: 100 },
        { type: 'issue-started', issueNumber: 1, issueTitle: 'bug', worktreePath: '/tmp' },
      ];

      for (const event of events) {
        await provider.notify(event);
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should skip when events filter is empty array', async () => {
      const provider = new WebhookProvider({
        url: 'https://example.com/hook',
        events: [],
      });
      await provider.notify(sampleEvent);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should not throw when fetch rejects', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });

      await expect(provider.notify(sampleEvent)).resolves.toBeUndefined();
    });

    it('should write fetch errors to stderr', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      mockFetch.mockRejectedValue(new Error('network error'));

      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      await provider.notify(sampleEvent);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('network error'));
      stderrSpy.mockRestore();
    });

    it('should not throw on HTTP error response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500));
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });

      await expect(provider.notify(sampleEvent)).resolves.toBeUndefined();
    });

    it('should write HTTP error status to stderr', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      mockFetch.mockResolvedValue(makeErrorResponse(503));

      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      await provider.notify(sampleEvent);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
      stderrSpy.mockRestore();
    });
  });

  describe('payload', () => {
    it('should send the full event object as JSON body', async () => {
      const event: CadreEvent = {
        type: 'issue-completed',
        issueNumber: 42,
        success: true,
        prNumber: 7,
        duration: 300,
        tokenUsage: 1500,
      };
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      await provider.notify(event);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(JSON.parse(callArgs.body)).toEqual(event);
    });

    it('should set Content-Type to application/json', async () => {
      const provider = new WebhookProvider({ url: 'https://example.com/hook' });
      await provider.notify(sampleEvent);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toEqual({ 'Content-Type': 'application/json' });
    });
  });
});
