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
    platform = {
      mergePullRequest,
      updatePullRequestBranch: vi.fn().mockResolvedValue(false),
      getPullRequest: vi.fn().mockResolvedValue({ mergeableState: 'clean' }),
    } as unknown as PlatformProvider;
  });

  it('skips enqueue and drain work when disabled', async () => {
    const queue = new PullRequestCompletionQueue(
      platform,
      logger,
      'main',
      'squash',
      false,
      vi.fn().mockResolvedValue(true),
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
    );

    queue.enqueue(makeItem({ issueNumber: 50, prNumber: 501, dependencyIssueNumbers: [] }));
    queue.enqueue(makeItem({ issueNumber: 51, prNumber: 502, dependencyIssueNumbers: [50] }));

    await queue.drain();

    expect(queue.getFailures()).toEqual([
      expect.objectContaining({
        issueNumber: 50,
        prNumber: 501,
        error: expect.stringContaining('Merge failed after retries for PR #501'),
      }),
      expect.objectContaining({
        issueNumber: 51,
        prNumber: 502,
        error: 'Blocked by unresolved dependency issue #50',
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Auto-complete failed for PR #501'),
      expect.any(Object),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping auto-complete for existing PR #502'),
      expect.any(Object),
    );
  });

  describe('merge conflict resolution', () => {
    it('invokes conflictResolver on dirty merge error and retries merge', async () => {
      const conflictResolver = vi.fn().mockResolvedValue(true);
      let callCount = 0;
      mergePullRequest.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('PR #101 has merge conflicts (mergeable_state=dirty)');
        }
      });

      const queue = new PullRequestCompletionQueue(
        platform,
        logger,
        'main',
        'squash',
        true,
        vi.fn().mockResolvedValue(true),
        conflictResolver,
        0, 0,
      );

      queue.enqueue(makeItem({ issueNumber: 60, prNumber: 601 }));
      await queue.drain();

      expect(conflictResolver).toHaveBeenCalledTimes(1);
      expect(conflictResolver).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 60, prNumber: 601 }),
        expect.stringContaining('merge conflicts'),
      );
      expect(mergePullRequest).toHaveBeenCalledTimes(2);
      expect(queue.getFailures()).toEqual([]);
    });

    it('records failure when conflictResolver returns false', async () => {
      const conflictResolver = vi.fn().mockResolvedValue(false);
      mergePullRequest.mockRejectedValue(
        new Error('PR #701 has merge conflicts (mergeable_state=dirty)'),
      );

      const queue = new PullRequestCompletionQueue(
        platform,
        logger,
        'main',
        'squash',
        true,
        vi.fn().mockResolvedValue(true),
        conflictResolver,
        0, 0,
      );

      queue.enqueue(makeItem({ issueNumber: 70, prNumber: 701 }));
      await queue.drain();

      expect(conflictResolver).toHaveBeenCalledTimes(1);
      expect(queue.getFailures()).toEqual([
        expect.objectContaining({
          issueNumber: 70,
          prNumber: 701,
          error: expect.stringContaining('Merge failed after retries for PR #701'),
        }),
      ]);
    });

    it('records failure when conflictResolver throws', async () => {
      const conflictResolver = vi.fn().mockRejectedValue(new Error('resolver crashed'));
      mergePullRequest.mockRejectedValue(
        new Error('PR #801 has merge conflicts (mergeable_state=dirty)'),
      );

      const queue = new PullRequestCompletionQueue(
        platform,
        logger,
        'main',
        'squash',
        true,
        vi.fn().mockResolvedValue(true),
        conflictResolver,
        0, 0,
      );

      queue.enqueue(makeItem({ issueNumber: 80, prNumber: 801 }));
      await queue.drain();

      expect(conflictResolver).toHaveBeenCalledTimes(1);
      expect(queue.getFailures()).toEqual([
        expect.objectContaining({ issueNumber: 80, prNumber: 801 }),
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Conflict resolver failed for PR #801'),
        expect.any(Object),
      );
    });

    it('does not invoke conflictResolver for non-dirty merge errors', async () => {
      const conflictResolver = vi.fn().mockResolvedValue(true);
      mergePullRequest.mockRejectedValue(new Error('some other merge error'));

      const queue = new PullRequestCompletionQueue(
        platform,
        logger,
        'main',
        'squash',
        true,
        vi.fn().mockResolvedValue(true),
        conflictResolver,
        0, 0,
      );

      queue.enqueue(makeItem({ issueNumber: 90, prNumber: 901 }));
      await queue.drain();

      expect(conflictResolver).not.toHaveBeenCalled();
      expect(queue.getFailures()).toEqual([
        expect.objectContaining({ issueNumber: 90, prNumber: 901 }),
      ]);
    });

    it('does not attempt conflict resolution without a resolver even on dirty errors', async () => {
      mergePullRequest.mockRejectedValue(
        new Error('PR has merge conflicts (mergeable_state=dirty)'),
      );

      const queue = new PullRequestCompletionQueue(
        platform,
        logger,
        'main',
        'squash',
        true,
        vi.fn().mockResolvedValue(true),
        // no conflictResolver
      );

      queue.enqueue(makeItem({ issueNumber: 100, prNumber: 1001 }));
      await queue.drain();

      // Should fail immediately without retry
      expect(mergePullRequest).toHaveBeenCalledTimes(1);
      expect(queue.getFailures()).toEqual([
        expect.objectContaining({ issueNumber: 100, prNumber: 1001 }),
      ]);
    });
  });
});
