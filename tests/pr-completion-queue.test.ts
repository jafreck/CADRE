import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@cadre/framework/core';
import type { PlatformProvider } from '../src/platform/provider.js';
import { PullRequestCompletionQueue } from '../src/core/pr-completion-queue.js';

function makeItem(overrides: Partial<{
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  dependencyIssueNumbers: number[];
}> = {}) {
  return {
    issueNumber: overrides.issueNumber ?? 1,
    issueTitle: overrides.issueTitle ?? 'Issue 1',
    prNumber: overrides.prNumber ?? 101,
    prUrl: overrides.prUrl ?? 'https://example.com/pr/101',
    branch: overrides.branch ?? 'cadre/issue-1',
    dependencyIssueNumbers: overrides.dependencyIssueNumbers ?? [],
  };
}

describe('PullRequestCompletionQueue', () => {
  let logger: Logger;
  let mergePullRequest: ReturnType<typeof vi.fn>;
  let platform: PlatformProvider;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mergePullRequest = vi.fn().mockResolvedValue(undefined);
    platform = { mergePullRequest } as unknown as PlatformProvider;
  });

  it('skips enqueue and drain work when disabled', async () => {
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      false,
      vi.fn().mockResolvedValue(true),
      2,
    );

    queue.enqueue(makeItem());
    expect(queue.getQueuedCount()).toBe(0);

    await queue.drain();

    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(queue.getFailures()).toEqual([]);
  });

  it('dedupes by PR number and does not enqueue duplicate completion work', async () => {
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      true,
      vi.fn().mockResolvedValue(true),
      2,
    );

    queue.enqueue(makeItem({ issueNumber: 10, prNumber: 210 }));
    queue.enqueue(makeItem({ issueNumber: 11, prNumber: 210, issueTitle: 'Issue 11' }));

    expect(queue.getQueuedCount()).toBe(1);
    await queue.drain();

    expect(mergePullRequest).toHaveBeenCalledTimes(1);
    expect(mergePullRequest).toHaveBeenCalledWith(210, 'main', 'squash');
  });

  it('drain is idempotent and does not retry already completed items', async () => {
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      true,
      vi.fn().mockResolvedValue(true),
      1,
    );

    queue.enqueue(makeItem({ issueNumber: 20, prNumber: 220 }));

    await queue.drain();
    await queue.drain();

    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });

  it('reuses in-flight dependency execution across dependents and drains fully', async () => {
    const dependencyReady = Promise.resolve();
    mergePullRequest.mockImplementation(async (prNumber: number) => {
      if (prNumber === 301) {
        await dependencyReady;
      }
    });

    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'merge',
      true,
      vi.fn().mockResolvedValue(true),
      3,
    );

    queue.enqueue(makeItem({ issueNumber: 30, prNumber: 301, dependencyIssueNumbers: [] }));
    queue.enqueue(makeItem({ issueNumber: 31, prNumber: 302, dependencyIssueNumbers: [30] }));
    queue.enqueue(makeItem({ issueNumber: 32, prNumber: 303, dependencyIssueNumbers: [30] }));

    await queue.drain();

    const dependencyCalls = mergePullRequest.mock.calls.filter(([pr]) => pr === 301);
    expect(dependencyCalls).toHaveLength(1);
    expect(mergePullRequest).toHaveBeenCalledTimes(3);
    expect(queue.getFailures()).toEqual([]);
  });

  it('records blocked dependency failures and warning when external dependency is unresolved', async () => {
    const isDependencySatisfied = vi.fn().mockResolvedValue(false);
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'rebase',
      true,
      isDependencySatisfied,
      1,
    );

    queue.enqueue(makeItem({ issueNumber: 40, prNumber: 401, dependencyIssueNumbers: [999] }));
    await queue.drain();

    expect(isDependencySatisfied).toHaveBeenCalledWith(999);
    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(queue.getFailures()).toEqual([
      expect.objectContaining({
        issueNumber: 40,
        prNumber: 401,
        error: 'Blocked by unresolved dependency issue #999',
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping auto-complete for existing PR #401'),
      expect.any(Object),
    );
  });

  it('records merge failure and blocks dependent queued issues', async () => {
    mergePullRequest.mockImplementation(async (prNumber: number) => {
      if (prNumber === 501) {
        throw new Error('merge API unavailable');
      }
    });

    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      true,
      vi.fn().mockResolvedValue(true),
      2,
    );

    queue.enqueue(makeItem({ issueNumber: 50, prNumber: 501, dependencyIssueNumbers: [] }));
    queue.enqueue(makeItem({ issueNumber: 51, prNumber: 502, dependencyIssueNumbers: [50] }));

    await queue.drain();

    expect(queue.getFailures()).toEqual([
      expect.objectContaining({
        issueNumber: 50,
        prNumber: 501,
        error: 'Error: merge API unavailable',
      }),
      expect.objectContaining({
        issueNumber: 51,
        prNumber: 502,
        error: 'Blocked by unresolved dependency issue #50',
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auto-complete failed for existing PR #501'),
      expect.any(Object),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping auto-complete for existing PR #502'),
      expect.any(Object),
    );
  });

  it('returns without side effects when executeItem is invoked for an unknown issue', async () => {
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      true,
      vi.fn().mockResolvedValue(true),
      1,
    );

    await (queue as unknown as { executeItem: (issueNumber: number) => Promise<void> }).executeItem(99999);

    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(queue.getFailures()).toEqual([]);
  });
});
