import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DogfoodProvider } from '../../src/notifications/dogfood-provider.js';
import type { DogfoodConfig } from '../../src/notifications/dogfood-provider.js';
import type { GitHubAPI } from '../../src/github/api.js';
import type { CadreEvent } from '../../src/logging/events.js';

function makeGitHubAPI(overrides: Partial<GitHubAPI> = {}): GitHubAPI {
  return {
    createIssue: vi.fn().mockResolvedValue({ number: 1, url: 'https://github.com/owner/repo/issues/1' }),
    ...overrides,
  } as unknown as GitHubAPI;
}

function makeConfig(overrides: Partial<DogfoodConfig> = {}): DogfoodConfig {
  return {
    maxIssuesPerRun: 5,
    labels: ['cadre-dogfood'],
    titlePrefix: '[CADRE Dogfood]',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CadreEvent> = {}): CadreEvent {
  return {
    type: 'fleet-started',
    issueCount: 3,
    maxParallel: 2,
    ...overrides,
  } as CadreEvent;
}

describe('DogfoodProvider', () => {
  let mockApi: GitHubAPI;
  let config: DogfoodConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = makeGitHubAPI();
    config = makeConfig();
  });

  describe('notify', () => {
    it('should create a GitHub issue with correct title and labels', async () => {
      const provider = new DogfoodProvider(mockApi, config);
      const event = makeEvent();

      await provider.notify(event);

      expect(mockApi.createIssue).toHaveBeenCalledOnce();
      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.title).toBe('[CADRE Dogfood] fleet-started');
      expect(call.labels).toEqual(['cadre-dogfood']);
    });

    it('should include event type and payload in the issue body', async () => {
      const provider = new DogfoodProvider(mockApi, config);
      const event = makeEvent();

      await provider.notify(event);

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.body).toContain('## Event: `fleet-started`');
      expect(call.body).toContain('### Payload');
      expect(call.body).toContain(JSON.stringify(event, null, 2));
    });

    it('should include a timestamp in the issue body', async () => {
      const provider = new DogfoodProvider(mockApi, config);

      await provider.notify(makeEvent());

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.body).toMatch(/\*\*Timestamp:\*\* \d{4}-\d{2}-\d{2}T/);
    });

    it('should use the configured titlePrefix', async () => {
      const provider = new DogfoodProvider(mockApi, makeConfig({ titlePrefix: '[Test]' }));

      await provider.notify(makeEvent());

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.title).toBe('[Test] fleet-started');
    });
  });

  describe('deduplication', () => {
    it('should not create duplicate issues for identical events', async () => {
      const provider = new DogfoodProvider(mockApi, config);
      const event = makeEvent();

      await provider.notify(event);
      await provider.notify(event);

      expect(mockApi.createIssue).toHaveBeenCalledOnce();
    });

    it('should create separate issues for different event types', async () => {
      const provider = new DogfoodProvider(mockApi, config);

      await provider.notify(makeEvent({ type: 'fleet-started', issueCount: 1, maxParallel: 1 } as CadreEvent));
      await provider.notify(makeEvent({
        type: 'fleet-completed',
        success: true,
        prsCreated: 0,
        failedIssues: 0,
        totalDuration: 100,
        totalTokens: 0,
      } as CadreEvent));

      expect(mockApi.createIssue).toHaveBeenCalledTimes(2);
    });

    it('should create separate issues for same type but different payloads', async () => {
      const provider = new DogfoodProvider(mockApi, config);

      await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
      await provider.notify({ type: 'fleet-started', issueCount: 2, maxParallel: 1 });

      expect(mockApi.createIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate limiting', () => {
    it('should stop creating issues after maxIssuesPerRun is reached', async () => {
      const provider = new DogfoodProvider(mockApi, makeConfig({ maxIssuesPerRun: 2 }));

      await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
      await provider.notify({ type: 'fleet-started', issueCount: 2, maxParallel: 1 });
      await provider.notify({ type: 'fleet-started', issueCount: 3, maxParallel: 1 });

      expect(mockApi.createIssue).toHaveBeenCalledTimes(2);
    });

    it('should silently skip events when maxIssuesPerRun is 0', async () => {
      const provider = new DogfoodProvider(mockApi, makeConfig({ maxIssuesPerRun: 0 }));

      await provider.notify(makeEvent());

      expect(mockApi.createIssue).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should catch and log errors without throwing', async () => {
      const failingApi = makeGitHubAPI({
        createIssue: vi.fn().mockRejectedValue(new Error('network error')),
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const provider = new DogfoodProvider(failingApi, config);

      await expect(provider.notify(makeEvent())).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DogfoodProvider: failed to create issue'),
      );

      consoleSpy.mockRestore();
    });

    it('should not increment issuesCreated on failure', async () => {
      const failingApi = makeGitHubAPI({
        createIssue: vi.fn().mockRejectedValue(new Error('fail')),
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const provider = new DogfoodProvider(failingApi, makeConfig({ maxIssuesPerRun: 1 }));

      // First call fails — should not count toward the cap
      await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });

      // Restore createIssue to succeed
      vi.mocked(failingApi.createIssue).mockResolvedValue({ number: 2, url: 'url' });

      // Second call with different payload should still go through
      await provider.notify({ type: 'fleet-started', issueCount: 2, maxParallel: 1 });
      expect(failingApi.createIssue).toHaveBeenCalledTimes(2);

      vi.mocked(console.error).mockRestore();
    });
  });
});
