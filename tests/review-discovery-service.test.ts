import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ReviewDiscoveryService,
  isSkipResult,
  type IssueDiscoveryResult,
  type IssueSkipResult,
  type DiscoveryResult,
} from '../src/core/review-discovery-service.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { PullRequestInfo, ReviewThread, PRComment, PRReview } from '../src/platform/provider.js';

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

function makeConfig(branchTemplate = 'cadre/issue-{issue}') {
  return makeRuntimeConfig({ branchTemplate });
}

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 10,
    url: 'https://github.com/owner/repo/pull/10',
    title: 'Test PR',
    headBranch: 'cadre/issue-1',
    baseBranch: 'main',
    state: 'open',
    ...overrides,
  };
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'thread-1',
    prNumber: 10,
    isResolved: false,
    isOutdated: false,
    comments: [],
    ...overrides,
  };
}

function makePRComment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: 'comment-1',
    author: 'reviewer',
    isBot: false,
    body: 'Please fix this',
    createdAt: new Date().toISOString(),
    url: 'https://github.com/owner/repo/pull/10#comment-1',
    ...overrides,
  };
}

function makePRReview(overrides: Partial<PRReview> = {}): PRReview {
  return {
    id: 'review-1',
    author: 'reviewer',
    isBot: false,
    body: 'Changes requested',
    state: 'CHANGES_REQUESTED',
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePlatform() {
  return {
    listPullRequests: vi.fn().mockResolvedValue([]),
    listPRReviewComments: vi.fn().mockResolvedValue([]),
    listPRComments: vi.fn().mockResolvedValue([]),
    listPRReviews: vi.fn().mockResolvedValue([]),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('isSkipResult', () => {
  it('should return true for skip results', () => {
    const skip: IssueSkipResult = { issueNumber: 1, skipReason: 'no open PR' };
    expect(isSkipResult(skip)).toBe(true);
  });

  it('should return false for discovery results', () => {
    const discovery: IssueDiscoveryResult = {
      issueNumber: 1,
      pr: makePR(),
      activeThreads: [],
      actionableComments: [],
      actionableReviews: [],
    };
    expect(isSkipResult(discovery)).toBe(false);
  });
});

describe('ReviewDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverActionableIssues', () => {
    it('should return skip result when issue has no matching open PR', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(results).toHaveLength(1);
      expect(isSkipResult(results[0])).toBe(true);
      expect((results[0] as IssueSkipResult).skipReason).toBe('no open PR');
    });

    it('should log info when no open PR is found for an issue', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      await service.discoverActionableIssues([42]);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('42'),
        expect.objectContaining({ issueNumber: 42 }),
      );
    });

    it('should return skip result when all threads are resolved', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([
        makeThread({ isResolved: true }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(results).toHaveLength(1);
      expect(isSkipResult(results[0])).toBe(true);
      expect((results[0] as IssueSkipResult).skipReason).toBe(
        'no unresolved review threads or PR comments',
      );
    });

    it('should return skip result when all threads are outdated', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([
        makeThread({ isOutdated: true }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(true);
    });

    it('should return discovery result when there are active threads', async () => {
      const platform = makePlatform();
      const pr = makePR();
      const thread = makeThread();
      platform.listPullRequests.mockResolvedValue([pr]);
      platform.listPRReviewComments.mockResolvedValue([thread]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(results).toHaveLength(1);
      expect(isSkipResult(results[0])).toBe(false);
      const result = results[0] as IssueDiscoveryResult;
      expect(result.pr).toBe(pr);
      expect(result.activeThreads).toEqual([thread]);
    });

    it('should return discovery result when there are actionable PR comments but no active threads', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]); // no threads
      platform.listPRComments.mockResolvedValue([makePRComment()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(false);
      const result = results[0] as IssueDiscoveryResult;
      expect(result.actionableComments).toHaveLength(1);
    });

    it('should return discovery result when there are actionable PR reviews but no active threads', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]); // no threads
      platform.listPRReviews.mockResolvedValue([makePRReview()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(false);
      const result = results[0] as IssueDiscoveryResult;
      expect(result.actionableReviews).toHaveLength(1);
    });

    it('should filter out bot comments from PR comments', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]);
      platform.listPRComments.mockResolvedValue([
        makePRComment({ isBot: true, body: 'codecov report' }),
        makePRComment({ id: 'c2', isBot: false, body: 'Please fix' }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(false);
      const result = results[0] as IssueDiscoveryResult;
      expect(result.actionableComments).toHaveLength(1);
      expect(result.actionableComments[0].id).toBe('c2');
    });

    it('should filter out empty-body comments from PR comments', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]);
      platform.listPRComments.mockResolvedValue([
        makePRComment({ body: '   ' }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(true);
    });

    it('should filter out bot reviews from PR reviews', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]);
      platform.listPRReviews.mockResolvedValue([
        makePRReview({ isBot: true }),
        makePRReview({ id: 'r2', isBot: false, body: 'Needs changes' }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      const result = results[0] as IssueDiscoveryResult;
      expect(result.actionableReviews).toHaveLength(1);
      expect(result.actionableReviews[0].id).toBe('r2');
    });

    it('should filter out empty-body reviews from PR reviews', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([]);
      platform.listPRReviews.mockResolvedValue([
        makePRReview({ body: '  ' }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(true);
    });

    it('should handle listPRComments failure gracefully', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      platform.listPRComments.mockRejectedValue(new Error('API error'));
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(false);
      const result = results[0] as IssueDiscoveryResult;
      expect(result.actionableComments).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('could not fetch PR comments'),
        expect.objectContaining({ issueNumber: 1 }),
      );
    });

    it('should handle listPRReviews failure gracefully', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([makePR()]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      platform.listPRReviews.mockRejectedValue(new Error('API error'));
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('could not fetch PR reviews'),
        expect.objectContaining({ issueNumber: 1 }),
      );
    });

    it('should discover all open PR issues when issueNumbers is not provided', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 10, headBranch: 'cadre/issue-1' }),
        makePR({ number: 11, headBranch: 'cadre/issue-2' }),
      ]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues();

      expect(results).toHaveLength(2);
    });

    it('should return empty array when no open PRs and no issueNumbers given', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues();

      expect(results).toEqual([]);
    });

    it('should match PRs to issues using the branch template regex', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 55, headBranch: 'cadre/issue-99' }),
      ]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([99]);

      expect(isSkipResult(results[0])).toBe(false);
      expect((results[0] as IssueDiscoveryResult).pr.number).toBe(55);
    });

    it('should skip PRs whose branch names do not match the template', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 77, headBranch: 'feature/unrelated' }),
      ]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      expect(isSkipResult(results[0])).toBe(true);
      expect((results[0] as IssueSkipResult).skipReason).toBe('no open PR');
    });

    it('should keep the first PR when multiple PRs map to the same issue', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 10, headBranch: 'cadre/issue-1' }),
        makePR({ number: 20, headBranch: 'cadre/issue-1' }),
      ]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1]);

      const result = results[0] as IssueDiscoveryResult;
      expect(result.pr.number).toBe(10);
    });

    it('should handle branch template with {title} token', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 10, headBranch: 'cadre/issue-5/some-title' }),
      ]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(
        makeConfig('cadre/issue-{issue}/{title}'),
        platform as any,
        logger as any,
      );

      const results = await service.discoverActionableIssues([5]);

      expect(isSkipResult(results[0])).toBe(false);
      expect((results[0] as IssueDiscoveryResult).pr.number).toBe(10);
    });

    it('should process multiple issues and return mixed results', async () => {
      const platform = makePlatform();
      platform.listPullRequests.mockResolvedValue([
        makePR({ number: 10, headBranch: 'cadre/issue-1' }),
      ]);
      platform.listPRReviewComments.mockResolvedValue([makeThread()]);
      const logger = makeLogger();
      const service = new ReviewDiscoveryService(makeConfig(), platform as any, logger as any);

      const results = await service.discoverActionableIssues([1, 2]);

      expect(results).toHaveLength(2);
      expect(isSkipResult(results[0])).toBe(false); // issue 1 has a PR
      expect(isSkipResult(results[1])).toBe(true); // issue 2 has no PR
    });
  });
});
