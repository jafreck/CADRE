import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { GitHubAPI } from '../src/github/api.js';

vi.mock('../src/github/api.js', () => ({
  GitHubAPI: vi.fn().mockImplementation(() => ({
    getIssue: vi.fn(),
    listIssues: vi.fn(),
    createPullRequest: vi.fn(),
    getPullRequest: vi.fn(),
    updatePullRequest: vi.fn(),
    getPRComments: vi.fn(),
    getPRReviewComments: vi.fn(),
    getPRReviews: vi.fn(),
    listPullRequests: vi.fn(),
    ensureLabel: vi.fn(),
    applyLabels: vi.fn(),
    addIssueComment: vi.fn(),
    checkAuth: vi.fn(),
  })),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

function getApiMock() {
  return vi.mocked(GitHubAPI).mock.results[0]?.value as {
    getIssue: ReturnType<typeof vi.fn>;
    listIssues: ReturnType<typeof vi.fn>;
    createPullRequest: ReturnType<typeof vi.fn>;
    getPullRequest: ReturnType<typeof vi.fn>;
    updatePullRequest: ReturnType<typeof vi.fn>;
    getPRComments: ReturnType<typeof vi.fn>;
    getPRReviewComments: ReturnType<typeof vi.fn>;
    getPRReviews: ReturnType<typeof vi.fn>;
    listPullRequests: ReturnType<typeof vi.fn>;
    ensureLabel: ReturnType<typeof vi.fn>;
    applyLabels: ReturnType<typeof vi.fn>;
    addIssueComment: ReturnType<typeof vi.fn>;
    checkAuth: ReturnType<typeof vi.fn>;
  };
}

describe('GitHubProvider – parseIssue type guards', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse a fully-populated issue', async () => {
    getApiMock().getIssue.mockResolvedValue({
      number: 42,
      title: 'Fix bug',
      body: 'Description here',
      state: 'open',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      labels: [{ name: 'bug' }, { name: 'priority' }],
      assignees: [{ login: 'alice' }],
      milestone: { title: 'v1.0' },
      comments: [
        { author: { login: 'bob' }, body: 'Comment text', createdAt: '2024-01-03T00:00:00Z' },
      ],
    });

    const issue = await provider.getIssue(42);

    expect(issue.number).toBe(42);
    expect(issue.title).toBe('Fix bug');
    expect(issue.body).toBe('Description here');
    expect(issue.state).toBe('open');
    expect(issue.labels).toEqual(['bug', 'priority']);
    expect(issue.assignees).toEqual(['alice']);
    expect(issue.milestone).toBe('v1.0');
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0].author).toBe('bob');
    expect(issue.comments[0].body).toBe('Comment text');
    expect(issue.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(issue.updatedAt).toBe('2024-01-02T00:00:00Z');
  });

  it('should fall back to defaults when numeric fields are missing', async () => {
    getApiMock().getIssue.mockResolvedValue({ title: 'No number', comments: [] });

    const issue = await provider.getIssue(0);

    expect(issue.number).toBe(0);
  });

  it('should fall back to empty string when string fields are absent', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 1, comments: [] });

    const issue = await provider.getIssue(1);

    expect(issue.title).toBe('');
    expect(issue.body).toBe('');
    expect(issue.createdAt).toBe('');
    expect(issue.updatedAt).toBe('');
  });

  it('should fall back to empty string when string fields have wrong type', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 5, title: 99, body: true, comments: [] });

    const issue = await provider.getIssue(5);

    expect(issue.title).toBe('');
    expect(issue.body).toBe('');
  });

  it('should default to "open" when state is not "closed"', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 3, state: 'unknown', comments: [] });

    const issue = await provider.getIssue(3);

    expect(issue.state).toBe('open');
  });

  it('should parse state "closed" correctly', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 7, state: 'closed', comments: [] });

    const issue = await provider.getIssue(7);

    expect(issue.state).toBe('closed');
  });

  it('should produce empty arrays when labels/assignees are absent', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 10, comments: [] });

    const issue = await provider.getIssue(10);

    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.comments).toEqual([]);
  });

  it('should omit milestone when raw.milestone is falsy', async () => {
    getApiMock().getIssue.mockResolvedValue({ number: 11, comments: [] });

    const issue = await provider.getIssue(11);

    expect(issue.milestone).toBeUndefined();
  });

  it('should use "unknown" as comment author fallback when author is absent', async () => {
    getApiMock().getIssue.mockResolvedValue({
      number: 12,
      comments: [{ body: 'hello', createdAt: '' }],
    });

    const issue = await provider.getIssue(12);

    expect(issue.comments[0].author).toBe('unknown');
  });

  it('should handle label objects with non-string name gracefully', async () => {
    getApiMock().getIssue.mockResolvedValue({
      number: 13,
      labels: [{ name: 123 }, { name: 'valid' }],
      comments: [],
    });

    const issue = await provider.getIssue(13);

    expect(issue.labels).toEqual(['', 'valid']);
  });
});

describe('GitHubProvider – createPullRequest type guards', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse a full createPullRequest response', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 55,
      html_url: 'https://github.com/owner/repo/pull/55',
      title: 'My PR',
    });

    const pr = await provider.createPullRequest({
      title: 'My PR',
      body: 'body',
      head: 'feature-branch',
      base: 'main',
    });

    expect(pr.number).toBe(55);
    expect(pr.url).toBe('https://github.com/owner/repo/pull/55');
    expect(pr.title).toBe('My PR');
    expect(pr.headBranch).toBe('feature-branch');
    expect(pr.baseBranch).toBe('main');
  });

  it('should fall back to params.title when response title is absent', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 56,
      html_url: 'https://github.com/owner/repo/pull/56',
    });

    const pr = await provider.createPullRequest({
      title: 'Fallback Title',
      body: 'body',
      head: 'branch',
      base: 'main',
    });

    expect(pr.title).toBe('Fallback Title');
  });

  it('should fall back to url when html_url is absent', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 57,
      url: 'https://api.github.com/repos/owner/repo/pulls/57',
    });

    const pr = await provider.createPullRequest({
      title: 'PR',
      body: '',
      head: 'branch',
      base: 'main',
    });

    expect(pr.url).toBe('https://api.github.com/repos/owner/repo/pulls/57');
  });

  it('should default number to 0 when absent from response', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      html_url: 'https://github.com/owner/repo/pull/0',
      title: 'PR',
    });

    const pr = await provider.createPullRequest({
      title: 'PR',
      body: '',
      head: 'branch',
      base: 'main',
    });

    expect(pr.number).toBe(0);
  });

  it('should pass labels to api.createPullRequest', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 60,
      html_url: 'https://github.com/owner/repo/pull/60',
      title: 'PR with labels',
    });

    await provider.createPullRequest({
      title: 'PR with labels',
      body: 'body',
      head: 'branch',
      base: 'main',
      labels: ['bug', 'enhancement'],
    });

    expect(getApiMock().createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['bug', 'enhancement'] }),
    );
  });

  it('should pass reviewers to api.createPullRequest', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 61,
      html_url: 'https://github.com/owner/repo/pull/61',
      title: 'PR with reviewers',
    });

    await provider.createPullRequest({
      title: 'PR with reviewers',
      body: 'body',
      head: 'branch',
      base: 'main',
      reviewers: ['alice', 'bob'],
    });

    expect(getApiMock().createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ reviewers: ['alice', 'bob'] }),
    );
  });

  it('should not include labels or reviewers when they are omitted', async () => {
    getApiMock().createPullRequest.mockResolvedValue({
      number: 62,
      html_url: 'https://github.com/owner/repo/pull/62',
      title: 'Plain PR',
    });

    await provider.createPullRequest({
      title: 'Plain PR',
      body: 'body',
      head: 'branch',
      base: 'main',
    });

    const callArgs = getApiMock().createPullRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('labels');
    expect(callArgs).not.toHaveProperty('reviewers');
  });
});

describe('GitHubProvider – getPullRequest type guards', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse a full getPullRequest response', async () => {
    getApiMock().getPullRequest.mockResolvedValue({
      number: 88,
      html_url: 'https://github.com/owner/repo/pull/88',
      title: 'Great PR',
      head: { ref: 'feature/cool' },
      base: { ref: 'main' },
    });

    const pr = await provider.getPullRequest(88);

    expect(pr.number).toBe(88);
    expect(pr.url).toBe('https://github.com/owner/repo/pull/88');
    expect(pr.title).toBe('Great PR');
    expect(pr.headBranch).toBe('feature/cool');
    expect(pr.baseBranch).toBe('main');
  });

  it('should default branch refs to empty string when head/base are absent', async () => {
    getApiMock().getPullRequest.mockResolvedValue({
      number: 89,
      title: 'PR no refs',
    });

    const pr = await provider.getPullRequest(89);

    expect(pr.headBranch).toBe('');
    expect(pr.baseBranch).toBe('');
  });

  it('should default branch refs to empty string when head/base are not objects', async () => {
    getApiMock().getPullRequest.mockResolvedValue({
      number: 90,
      head: 'not-an-object',
      base: 42,
    });

    const pr = await provider.getPullRequest(90);

    expect(pr.headBranch).toBe('');
    expect(pr.baseBranch).toBe('');
  });
});

describe('GitHubProvider – listPRReviewComments parsing', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should return [] when the MCP response has an empty reviewThreads array', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({ reviewThreads: [] });

    const threads = await provider.listPRReviewComments(1);

    expect(threads).toEqual([]);
  });

  it('should return [] when the MCP response is null or missing reviewThreads', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue(null);

    const threads = await provider.listPRReviewComments(1);

    expect(threads).toEqual([]);

    getApiMock().getPRReviewComments.mockResolvedValue({ threads: [] });

    const threadsMissingField = await provider.listPRReviewComments(1);

    expect(threadsMissingField).toEqual([]);
  });

  it('should parse a fully-populated review thread', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        {
          ID: 'thread-1',
          IsResolved: false,
          IsOutdated: false,
          Comments: {
            Nodes: [
              {
                ID: 'comment-1',
                Author: { Login: 'alice' },
                Body: 'Please fix this.',
                CreatedAt: '2024-03-01T10:00:00Z',
                Path: 'src/foo.ts',
                Line: 42,
              },
            ],
          },
        },
      ],
    });

    const threads = await provider.listPRReviewComments(10);

    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('thread-1');
    expect(threads[0].prNumber).toBe(10);
    expect(threads[0].isResolved).toBe(false);
    expect(threads[0].isOutdated).toBe(false);
    expect(threads[0].comments).toHaveLength(1);
    expect(threads[0].comments[0].id).toBe('comment-1');
    expect(threads[0].comments[0].author).toBe('alice');
    expect(threads[0].comments[0].body).toBe('Please fix this.');
    expect(threads[0].comments[0].createdAt).toBe('2024-03-01T10:00:00Z');
    expect(threads[0].comments[0].path).toBe('src/foo.ts');
    expect(threads[0].comments[0].line).toBe(42);
  });

  it('should map isResolved and isOutdated correctly', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        { ID: 'r', IsResolved: true, IsOutdated: true, Comments: { Nodes: [] } },
      ],
    });

    const threads = await provider.listPRReviewComments(5);

    expect(threads[0].isResolved).toBe(true);
    expect(threads[0].isOutdated).toBe(true);
  });

  it('should default isResolved and isOutdated to false when absent', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        { ID: 'r', Comments: { Nodes: [] } },
      ],
    });

    const threads = await provider.listPRReviewComments(5);

    expect(threads[0].isResolved).toBe(false);
    expect(threads[0].isOutdated).toBe(false);
  });

  it('should default comment author to "unknown" when absent', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        {
          ID: 'thread-2',
          IsResolved: false,
          IsOutdated: false,
          Comments: { Nodes: [{ ID: 'c1', Body: 'Hi', CreatedAt: '', Path: 'a.ts' }] },
        },
      ],
    });

    const threads = await provider.listPRReviewComments(2);

    expect(threads[0].comments[0].author).toBe('unknown');
  });

  it('should produce an empty comments array when thread has no comments', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        { ID: 'empty-thread', IsResolved: false, IsOutdated: false, Comments: { Nodes: [] } },
      ],
    });

    const threads = await provider.listPRReviewComments(3);

    expect(threads[0].comments).toEqual([]);
  });

  it('should omit line from comment when it is not a number', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        {
          ID: 'thread-3',
          IsResolved: false,
          IsOutdated: false,
          Comments: {
            Nodes: [{ ID: 'c2', Author: { Login: 'bob' }, Body: 'test', CreatedAt: '', Path: 'b.ts' }],
          },
        },
      ],
    });

    const threads = await provider.listPRReviewComments(4);

    expect(threads[0].comments[0].line).toBeUndefined();
  });

  it('should parse multiple threads correctly', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        { ID: 't1', IsResolved: false, IsOutdated: false, Comments: { Nodes: [] } },
        { ID: 't2', IsResolved: true, IsOutdated: false, Comments: { Nodes: [] } },
      ],
    });

    const threads = await provider.listPRReviewComments(7);

    expect(threads).toHaveLength(2);
    expect(threads[0].id).toBe('t1');
    expect(threads[1].id).toBe('t2');
    expect(threads[1].isResolved).toBe(true);
  });

  it('should parse threads from an envelope { reviewThreads: [...] } response', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({
      reviewThreads: [
        { ID: 'env-thread-1', IsResolved: false, IsOutdated: false, Comments: { Nodes: [] } },
      ],
    });

    const threads = await provider.listPRReviewComments(9);

    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('env-thread-1');
  });

  it('should return [] when envelope reviewThreads field is missing or non-array', async () => {
    getApiMock().getPRReviewComments.mockResolvedValue({ reviewThreads: null });

    const threads = await provider.listPRReviewComments(9);

    expect(threads).toEqual([]);
  });
});

describe('GitHubProvider – listPullRequests type guards', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse a list of pull requests', async () => {
    getApiMock().listPullRequests.mockResolvedValue([
      {
        number: 10,
        html_url: 'https://github.com/owner/repo/pull/10',
        title: 'PR 10',
        head: { ref: 'branch-a' },
        base: { ref: 'main' },
      },
      {
        number: 11,
        html_url: 'https://github.com/owner/repo/pull/11',
        title: 'PR 11',
        head: { ref: 'branch-b' },
        base: { ref: 'main' },
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(2);
    expect(prs[0].number).toBe(10);
    expect(prs[0].headBranch).toBe('branch-a');
    expect(prs[1].number).toBe(11);
    expect(prs[1].headBranch).toBe('branch-b');
  });

  it('should produce empty list when API returns empty array', async () => {
    getApiMock().listPullRequests.mockResolvedValue([]);

    const prs = await provider.listPullRequests();

    expect(prs).toEqual([]);
  });

  it('should default missing fields to empty string and 0 for each PR', async () => {
    getApiMock().listPullRequests.mockResolvedValue([{ url: 'https://api.github.com/repos/owner/repo/pulls/0' }]);

    const prs = await provider.listPullRequests();

    expect(prs[0].number).toBe(0);
    expect(prs[0].title).toBe('');
    expect(prs[0].url).toBe('https://api.github.com/repos/owner/repo/pulls/0');
    expect(prs[0].headBranch).toBe('');
    expect(prs[0].baseBranch).toBe('');
  });
});

describe('GitHubProvider – findOpenPR', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should return the matching PR when listPullRequests returns a PR with matching headBranch', async () => {
    getApiMock().listPullRequests.mockResolvedValue([
      {
        number: 42,
        html_url: 'https://github.com/owner/repo/pull/42',
        title: 'Fix issue 7',
        head: { ref: 'cadre/issue-7-fix-bug' },
        base: { ref: 'main' },
      },
    ]);

    const pr = await provider.findOpenPR(7, 'cadre/issue-7-fix-bug');

    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(42);
    expect(pr!.headBranch).toBe('cadre/issue-7-fix-bug');
    expect(pr!.url).toBe('https://github.com/owner/repo/pull/42');
  });

  it('should return null when listPullRequests returns an empty array', async () => {
    getApiMock().listPullRequests.mockResolvedValue([]);

    const pr = await provider.findOpenPR(5, 'cadre/issue-5-some-feature');

    expect(pr).toBeNull();
  });

  it('should return null when no PR matches the given branch name', async () => {
    getApiMock().listPullRequests.mockResolvedValue([
      {
        number: 99,
        html_url: 'https://github.com/owner/repo/pull/99',
        title: 'Unrelated PR',
        head: { ref: 'cadre/issue-99-other' },
        base: { ref: 'main' },
      },
    ]);

    const pr = await provider.findOpenPR(5, 'cadre/issue-5-some-feature');

    expect(pr).toBeNull();
  });

  it('should call listPullRequests with head and state open filters', async () => {
    getApiMock().listPullRequests.mockResolvedValue([]);

    await provider.findOpenPR(3, 'my-feature-branch');

    expect(getApiMock().listPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'my-feature-branch', state: 'open' }),
    );
  });

  it('should return the first matching PR when multiple PRs match the branch', async () => {
    getApiMock().listPullRequests.mockResolvedValue([
      {
        number: 10,
        html_url: 'https://github.com/owner/repo/pull/10',
        title: 'First PR',
        head: { ref: 'feature-branch' },
        base: { ref: 'main' },
      },
      {
        number: 11,
        html_url: 'https://github.com/owner/repo/pull/11',
        title: 'Second PR',
        head: { ref: 'feature-branch' },
        base: { ref: 'main' },
      },
    ]);

    const pr = await provider.findOpenPR(1, 'feature-branch');

    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(10);
  });
});

describe('GitHubProvider – listIssues', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should return a list of issue details', async () => {
    getApiMock().listIssues.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    getApiMock().getIssue
      .mockResolvedValueOnce({ number: 1, title: 'First', state: 'open', comments: [] })
      .mockResolvedValueOnce({ number: 2, title: 'Second', state: 'closed', comments: [] });

    const issues = await provider.listIssues({});

    expect(issues).toHaveLength(2);
    expect(issues[0].number).toBe(1);
    expect(issues[1].number).toBe(2);
  });

  it('should skip issues that fail to fetch and log a warning', async () => {
    getApiMock().listIssues.mockResolvedValue([{ number: 10 }, { number: 11 }]);
    getApiMock().getIssue
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({ number: 11, title: 'Good', state: 'open', comments: [] });

    const issues = await provider.listIssues({});

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(11);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('#10'),
      expect.any(Object),
    );
  });

  it('should return empty array when listIssues returns empty', async () => {
    getApiMock().listIssues.mockResolvedValue([]);

    const issues = await provider.listIssues({});

    expect(issues).toEqual([]);
  });

  it('should ignore pull_request items returned by api.listIssues', async () => {
    getApiMock().listIssues.mockResolvedValue([
      { number: 1 },
      { number: 999, pull_request: { url: 'https://api.github.com/pulls/999' } },
      { number: 2 },
    ]);
    getApiMock().getIssue
      .mockResolvedValueOnce({ number: 1, title: 'First', state: 'open', comments: [] })
      .mockResolvedValueOnce({ number: 2, title: 'Second', state: 'open', comments: [] });

    const issues = await provider.listIssues({});

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(getApiMock().getIssue).toHaveBeenCalledTimes(2);
    expect(getApiMock().getIssue).not.toHaveBeenCalledWith(999);
  });
});

describe('GitHubProvider – addIssueComment', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should call api.addIssueComment with correct arguments', async () => {
    getApiMock().addIssueComment.mockResolvedValue(undefined);

    await provider.addIssueComment(42, 'Hello!');

    expect(getApiMock().addIssueComment).toHaveBeenCalledWith(42, 'Hello!');
  });
});

describe('GitHubProvider – updatePullRequest', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should call api.updatePullRequest with correct arguments', async () => {
    getApiMock().updatePullRequest.mockResolvedValue(undefined);

    await provider.updatePullRequest(55, { title: 'New Title', body: 'New body' });

    expect(getApiMock().updatePullRequest).toHaveBeenCalledWith(55, { title: 'New Title', body: 'New body' });
  });
});

describe('GitHubProvider – ensureLabel and applyLabels', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should call api.ensureLabel with name and color', async () => {
    getApiMock().ensureLabel.mockResolvedValue(undefined);

    await provider.ensureLabel('bug', 'ff0000');

    expect(getApiMock().ensureLabel).toHaveBeenCalledWith('bug', 'ff0000');
  });

  it('should call api.ensureLabel without color', async () => {
    getApiMock().ensureLabel.mockResolvedValue(undefined);

    await provider.ensureLabel('enhancement');

    expect(getApiMock().ensureLabel).toHaveBeenCalledWith('enhancement', undefined);
  });

  it('should call api.applyLabels with prNumber and labels', async () => {
    getApiMock().applyLabels.mockResolvedValue(undefined);

    await provider.applyLabels(10, ['bug', 'wontfix']);

    expect(getApiMock().applyLabels).toHaveBeenCalledWith(10, ['bug', 'wontfix']);
  });
});

describe('GitHubProvider – listPRComments', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse an array of PR comments', async () => {
    getApiMock().getPRComments.mockResolvedValue([
      {
        id: 'c1',
        user: { login: 'alice', type: 'User' },
        body: 'Looks good!',
        created_at: '2024-01-01T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#comment-1',
      },
    ]);

    const comments = await provider.listPRComments(1);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe('c1');
    expect(comments[0].author).toBe('alice');
    expect(comments[0].isBot).toBe(false);
    expect(comments[0].body).toBe('Looks good!');
    expect(comments[0].createdAt).toBe('2024-01-01T00:00:00Z');
    expect(comments[0].url).toBe('https://github.com/owner/repo/pull/1#comment-1');
  });

  it('should detect bot comments by login containing [bot]', async () => {
    getApiMock().getPRComments.mockResolvedValue([
      { id: 'b1', user: { login: 'github-actions[bot]' }, body: 'CI passed', created_at: '', html_url: '' },
    ]);

    const comments = await provider.listPRComments(2);

    expect(comments[0].isBot).toBe(true);
  });

  it('should detect bot comments by user type', async () => {
    getApiMock().getPRComments.mockResolvedValue([
      { id: 'b2', user: { login: 'some-bot', type: 'Bot' }, body: 'Auto comment', created_at: '', html_url: '' },
    ]);

    const comments = await provider.listPRComments(3);

    expect(comments[0].isBot).toBe(true);
  });

  it('should parse an envelope { comments: [...] } response', async () => {
    getApiMock().getPRComments.mockResolvedValue({
      comments: [{ id: 'e1', user: { login: 'bob' }, body: 'hi', created_at: '', html_url: '' }],
    });

    const comments = await provider.listPRComments(4);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe('e1');
  });

  it('should return empty array for null or non-array non-object response', async () => {
    getApiMock().getPRComments.mockResolvedValue(null);

    const comments = await provider.listPRComments(5);

    expect(comments).toEqual([]);
  });

  it('should fall back to author field when user is absent', async () => {
    getApiMock().getPRComments.mockResolvedValue([
      { id: 'c3', author: { login: 'charlie' }, body: 'noted', created_at: '', html_url: '' },
    ]);

    const comments = await provider.listPRComments(6);

    expect(comments[0].author).toBe('charlie');
  });
});

describe('GitHubProvider – listPRReviews', () => {
  let provider: GitHubProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
    await provider.connect();
  });

  it('should parse an array of PR reviews', async () => {
    getApiMock().getPRReviews.mockResolvedValue([
      {
        id: 'r1',
        user: { login: 'alice', type: 'User' },
        body: 'LGTM',
        state: 'APPROVED',
        submitted_at: '2024-01-05T00:00:00Z',
      },
    ]);

    const reviews = await provider.listPRReviews(1);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe('r1');
    expect(reviews[0].author).toBe('alice');
    expect(reviews[0].isBot).toBe(false);
    expect(reviews[0].body).toBe('LGTM');
    expect(reviews[0].state).toBe('APPROVED');
    expect(reviews[0].submittedAt).toBe('2024-01-05T00:00:00Z');
  });

  it('should detect bot reviews by login', async () => {
    getApiMock().getPRReviews.mockResolvedValue([
      { id: 'rb1', user: { login: 'coderabbitai[bot]' }, body: '', state: 'COMMENTED', submitted_at: '' },
    ]);

    const reviews = await provider.listPRReviews(2);

    expect(reviews[0].isBot).toBe(true);
  });

  it('should parse an envelope { reviews: [...] } response', async () => {
    getApiMock().getPRReviews.mockResolvedValue({
      reviews: [{ id: 'er1', user: { login: 'bob' }, body: 'ok', state: 'APPROVED', submitted_at: '' }],
    });

    const reviews = await provider.listPRReviews(3);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe('er1');
  });

  it('should return empty array for null response', async () => {
    getApiMock().getPRReviews.mockResolvedValue(null);

    const reviews = await provider.listPRReviews(4);

    expect(reviews).toEqual([]);
  });

  it('should fall back to author field when user is absent', async () => {
    getApiMock().getPRReviews.mockResolvedValue([
      { id: 'r2', author: { login: 'dave' }, body: '', state: 'CHANGES_REQUESTED', submitted_at: '' },
    ]);

    const reviews = await provider.listPRReviews(5);

    expect(reviews[0].author).toBe('dave');
  });

  it('should fall back to submittedAt field when submitted_at is absent', async () => {
    getApiMock().getPRReviews.mockResolvedValue([
      { id: 'r3', user: { login: 'eve' }, body: '', state: 'APPROVED', submittedAt: '2024-06-01T00:00:00Z' },
    ]);

    const reviews = await provider.listPRReviews(6);

    expect(reviews[0].submittedAt).toBe('2024-06-01T00:00:00Z');
  });
});

describe('GitHubProvider – lifecycle', () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubProvider('owner/repo', mockLogger);
  });

  it('should throw when calling getIssue before connect()', async () => {
    await expect(provider.getIssue(1)).rejects.toThrow('not connected');
  });

  it('should throw when calling checkAuth before connect()', async () => {
    await expect(provider.checkAuth()).rejects.toThrow('not connected');
  });

  it('should not throw after connect()', async () => {
    await provider.connect();
    getApiMock().getIssue.mockResolvedValue({ number: 1, comments: [] });
    await expect(provider.getIssue(1)).resolves.toBeDefined();
  });

  it('should throw after disconnect()', async () => {
    await provider.connect();
    await provider.disconnect();
    await expect(provider.getIssue(1)).rejects.toThrow('not connected');
  });

  it('checkAuth should delegate to api.checkAuth and return true', async () => {
    await provider.connect();
    getApiMock().checkAuth.mockResolvedValue(true);

    const result = await provider.checkAuth();

    expect(result).toBe(true);
    expect(getApiMock().checkAuth).toHaveBeenCalled();
  });

  it('checkAuth should return false when api.checkAuth returns false', async () => {
    await provider.connect();
    getApiMock().checkAuth.mockResolvedValue(false);

    const result = await provider.checkAuth();

    expect(result).toBe(false);
  });

  it('issueLinkSuffix should return correct closing suffix', () => {
    expect(provider.issueLinkSuffix(42)).toBe('Closes #42');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mergePullRequest
// ──────────────────────────────────────────────────────────────────────────────

describe('GitHubProvider – mergePullRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call octokit.rest.pulls.merge with the correct parameters', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true } });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);
    await provider.connect();

    await provider.mergePullRequest(42, 'main');

    expect(mergeMock).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      merge_method: 'merge',
    });
  });

  it('should ignore baseBranch parameter (uses Octokit merge defaults)', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true } });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);
    await provider.connect();

    // baseBranch is intentionally unused — just verify no error is thrown
    await expect(provider.mergePullRequest(10, 'develop')).resolves.toBeUndefined();
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors thrown by octokit merge', async () => {
    const mergeMock = vi.fn().mockRejectedValue(new Error('PR not mergeable'));
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);
    await provider.connect();

    await expect(provider.mergePullRequest(99, 'main')).rejects.toThrow('PR not mergeable');
  });

  it('should work without connecting first (uses injected octokit directly)', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true } });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    // Not connected — mergePullRequest should still work with injected octokit
    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(5, 'main')).resolves.toBeUndefined();
    expect(mergeMock).toHaveBeenCalled();
  });

  it('retries merge after retryable status when checks become mergeable', async () => {
    const mergeError = Object.assign(new Error('conflict'), { status: 409 });
    const mergeMock = vi
      .fn()
      .mockRejectedValueOnce(mergeError)
      .mockResolvedValueOnce({ data: { merged: true } });
    const getMock = vi.fn().mockResolvedValue({
      data: {
        merged: false,
        state: 'open',
        head: { sha: 'abc123' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    });
    const updateBranchMock = vi.fn().mockResolvedValue({});
    const combinedStatusMock = vi.fn().mockResolvedValue({ data: { state: 'success', statuses: [] } });
    const listForRefMock = vi.fn().mockResolvedValue({
      data: { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] },
    });

    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: getMock, updateBranch: updateBranchMock },
        repos: { getCombinedStatusForRef: combinedStatusMock },
        checks: { listForRef: listForRefMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(88, 'main', 'squash')).resolves.toBeUndefined();

    expect(mergeMock).toHaveBeenCalledTimes(2);
    expect(mergeMock).toHaveBeenLastCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 88,
      merge_method: 'squash',
    });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(combinedStatusMock).toHaveBeenCalledTimes(1);
    expect(listForRefMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-retryable merge errors', async () => {
    const mergeError = Object.assign(new Error('server exploded'), { status: 500 });
    const mergeMock = vi.fn().mockRejectedValue(mergeError);
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(11, 'main')).rejects.toBe(mergeError);
  });

  it('rethrows retryable merge errors when monitoring APIs are unavailable', async () => {
    const mergeError = Object.assign(new Error('merge not ready'), { status: 409 });
    const mergeMock = vi.fn().mockRejectedValue(mergeError);
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(12, 'main')).rejects.toBe(mergeError);
  });

  it('throws when PR closes while waiting for merge readiness', async () => {
    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 422 });
    const getMock = vi.fn().mockResolvedValue({
      data: {
        merged: false,
        state: 'closed',
        head: { sha: 'def456' },
      },
    });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: getMock, updateBranch: vi.fn() },
        repos: { getCombinedStatusForRef: vi.fn() },
        checks: { listForRef: vi.fn() },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(13, 'main')).rejects.toThrow(
      'closed before auto-complete could finish',
    );
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it('throws when PR head SHA is missing during monitoring', async () => {
    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 405 });
    const getMock = vi.fn().mockResolvedValue({
      data: {
        merged: false,
        state: 'open',
        head: {},
      },
    });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: getMock, updateBranch: vi.fn() },
        repos: { getCombinedStatusForRef: vi.fn() },
        checks: { listForRef: vi.fn() },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(14, 'main')).rejects.toThrow('has no head SHA');
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it('logs warning and continues when updateBranch fails for behind PRs', async () => {
    const mergeMock = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 409 } })
      .mockResolvedValueOnce({ data: { merged: true } });
    const getMock = vi.fn().mockResolvedValue({
      data: {
        merged: false,
        state: 'open',
        head: { sha: 'feedbeef' },
        mergeable: true,
        mergeable_state: 'behind',
      },
    });
    const updateBranchMock = vi.fn().mockRejectedValue(new Error('forbidden'));

    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: getMock, updateBranch: updateBranchMock },
        repos: { getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { state: 'success', statuses: [] } }) },
        checks: {
          listForRef: vi
            .fn()
            .mockResolvedValue({ data: { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] } }),
        },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(15, 'main')).resolves.toBeUndefined();

    expect(updateBranchMock).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not update PR #15 branch from base'));
    expect(mergeMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast when mergeable_state is dirty', async () => {
    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 409 });
    const mockOctokit = {
      rest: {
        pulls: {
          merge: mergeMock,
          get: vi.fn().mockResolvedValue({
            data: {
              merged: false,
              state: 'open',
              head: { sha: 'deadbeef' },
              mergeable: false,
              mergeable_state: 'dirty',
            },
          }),
          updateBranch: vi.fn(),
        },
        repos: { getCombinedStatusForRef: vi.fn() },
        checks: { listForRef: vi.fn() },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(151, 'main')).rejects.toThrow('mergeable_state=dirty');
  });

  it('throws when combined commit statuses are failing with no named contexts', async () => {
    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 409 });
    const mockOctokit = {
      rest: {
        pulls: {
          merge: mergeMock,
          get: vi.fn().mockResolvedValue({
            data: {
              merged: false,
              state: 'open',
              head: { sha: 'abc999' },
              mergeable: true,
              mergeable_state: 'clean',
            },
          }),
          updateBranch: vi.fn(),
        },
        repos: { getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { state: 'failure', statuses: [] } }) },
        checks: { listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [] } }) },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(16, 'main')).rejects.toThrow('checks failed: commit-status');
  });

  it('does not treat combined status pending as blocking when there are no actual commit statuses', async () => {
    // Repos using only GitHub Actions (check runs) have zero commit statuses,
    // causing getCombinedStatusForRef to return state='pending'.  This should
    // not block the merge when all check runs are passing.
    const mergeMock = vi.fn()
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({ data: { merged: true } });
    const getMock = vi.fn().mockResolvedValue({
      data: {
        merged: false,
        state: 'open',
        head: { sha: 'sha-no-statuses' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: getMock, updateBranch: vi.fn() },
        repos: { getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { state: 'pending', statuses: [] } }) },
        checks: {
          listForRef: vi.fn().mockResolvedValue({
            data: { check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }] },
          }),
        },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    // Should succeed — combined status 'pending' with empty statuses should not block
    await expect(provider.mergePullRequest(200, 'main')).resolves.toBeUndefined();
    expect(mergeMock).toHaveBeenCalledTimes(2);
  });

  it('throws when completed check runs finish with failing conclusions', async () => {
    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 409 });
    const mockOctokit = {
      rest: {
        pulls: {
          merge: mergeMock,
          get: vi.fn().mockResolvedValue({
            data: {
              merged: false,
              state: 'open',
              head: { sha: 'bead1234' },
              mergeable: true,
              mergeable_state: 'clean',
            },
          }),
          updateBranch: vi.fn(),
        },
        repos: { getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { state: 'success', statuses: [] } }) },
        checks: {
          listForRef: vi.fn().mockResolvedValue({
            data: {
              check_runs: [{ name: 'integration', status: 'completed', conclusion: 'cancelled' }],
            },
          }),
        },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(17, 'main')).rejects.toThrow('checks failed: integration');
  });

  it('throws timeout error when readiness polling deadline is exceeded', async () => {
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValue(2_000_000);

    const mergeMock = vi.fn().mockRejectedValueOnce({ status: 409 });
    const mockOctokit = {
      rest: {
        pulls: { merge: mergeMock, get: vi.fn(), updateBranch: vi.fn() },
        repos: { getCombinedStatusForRef: vi.fn() },
        checks: { listForRef: vi.fn() },
      },
    };

    const provider = new GitHubProvider('owner/repo', mockLogger, mockOctokit as any);

    await expect(provider.mergePullRequest(18, 'main')).rejects.toThrow(
      'Timed out waiting for PR #18 checks/mergeability',
    );
    dateNowSpy.mockRestore();
  });
});
