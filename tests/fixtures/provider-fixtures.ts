import type {
  IssueDetail,
  PRComment,
  PRReview,
  PullRequestInfo,
  ReviewThread,
} from '../../src/platform/provider.js';

export const FIXTURE_ISSUE: IssueDetail = {
  number: 42,
  title: 'Fixture Issue',
  body: 'This is a fixture issue body.',
  labels: ['bug'],
  assignees: ['octocat'],
  comments: [
    {
      author: 'octocat',
      body: 'Fixture comment',
      createdAt: '2024-01-02T00:00:00Z',
    },
  ],
  state: 'open',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  linkedPRs: [7],
};

export const FIXTURE_PR: PullRequestInfo = {
  number: 7,
  url: 'https://github.com/mock/repo/pull/7',
  title: 'Fixture PR',
  headBranch: 'issue-42-fix',
  baseBranch: 'main',
  state: 'open',
};

export const FIXTURE_PR_COMMENT: PRComment = {
  id: 'comment-1',
  author: 'octocat',
  isBot: false,
  body: 'Fixture PR comment body.',
  createdAt: '2024-01-03T00:00:00Z',
  url: 'https://github.com/mock/repo/pull/7#issuecomment-1',
};

export const FIXTURE_PR_REVIEW: PRReview = {
  id: 'review-1',
  author: 'reviewer',
  isBot: false,
  body: 'Fixture review body.',
  state: 'APPROVED',
  submittedAt: '2024-01-04T00:00:00Z',
};

export const FIXTURE_REVIEW_THREAD: ReviewThread = {
  id: 'thread-1',
  prNumber: 7,
  isResolved: false,
  isOutdated: false,
  comments: [
    {
      id: 'review-comment-1',
      author: 'reviewer',
      body: 'Fixture review thread comment.',
      createdAt: '2024-01-04T00:00:00Z',
      path: 'src/index.ts',
      line: 10,
    },
  ],
};
