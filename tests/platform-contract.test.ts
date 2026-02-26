/**
 * Platform provider contract tests.
 *
 * This file runs the same assertions against both GitHubProvider and
 * AzureDevOpsProvider to verify that both implementations satisfy the
 * PlatformProvider contract defined in src/platform/provider.ts.
 *
 * All HTTP is mocked — no real network calls are made.
 *
 * PROVIDER DEVIATIONS (known differences from the contract):
 *   - AzureDevOpsProvider.listPRReviewComments: always returns [] (not yet implemented)
 *   - AzureDevOpsProvider.listPRComments: always returns [] (not yet implemented)
 *   - AzureDevOpsProvider.listPRReviews: always returns [] (not yet implemented)
 *   - AzureDevOpsProvider.applyLabels: no-op stub (label management not yet implemented)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';
import { GitHubAPI } from '../src/github/api.js';
import type {
  IssueDetail,
  PullRequestInfo,
  PRComment,
  PRReview,
  ReviewThread,
} from '../src/platform/provider.js';

// ── GitHubAPI is fully mocked so GitHubProvider can be tested without network ──
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
    checkAuth: vi.fn().mockResolvedValue(true),
  })),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** Returns the GitHubAPI mock instance created during the last GitHubProvider.connect(). */
function getGitHubApiMock() {
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

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns a pre-connected AzureDevOpsProvider with fetch stubbed. */
async function makeConnectedAdoProvider(
  fetchStub: ReturnType<typeof vi.fn>,
): Promise<AzureDevOpsProvider> {
  // First call: checkAuth during connect()
  fetchStub.mockResolvedValueOnce(okJson({ id: 'proj-id', name: 'my-project' }));
  const provider = new AzureDevOpsProvider(
    { organization: 'my-org', project: 'my-project', auth: { pat: 'secret-pat' } },
    mockLogger,
  );
  await provider.connect();
  return provider;
}

// ── Shared type-guard assertions ──

function assertIssueDetailShape(issue: IssueDetail): void {
  expect(typeof issue.number).toBe('number');
  expect(typeof issue.title).toBe('string');
  expect(typeof issue.body).toBe('string');
  expect(Array.isArray(issue.labels)).toBe(true);
  expect(Array.isArray(issue.assignees)).toBe(true);
  expect(['open', 'closed']).toContain(issue.state);
  expect(Array.isArray(issue.comments)).toBe(true);
  expect(typeof issue.createdAt).toBe('string');
  expect(typeof issue.updatedAt).toBe('string');
  expect(Array.isArray(issue.linkedPRs)).toBe(true);
}

function assertPullRequestInfoShape(pr: PullRequestInfo): void {
  expect(typeof pr.number).toBe('number');
  expect(typeof pr.url).toBe('string');
  expect(typeof pr.title).toBe('string');
  expect(typeof pr.headBranch).toBe('string');
  expect(typeof pr.baseBranch).toBe('string');
  expect(['open', 'closed', 'merged']).toContain(pr.state);
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 1: getIssue returns normalized IssueDetail
// ══════════════════════════════════════════════════════════════════

describe('Contract: getIssue returns normalized IssueDetail', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns IssueDetail with all required fields', async () => {
      getGitHubApiMock().getIssue.mockResolvedValue({
        number: 42,
        title: 'Contract test issue',
        body: 'Issue body',
        state: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        labels: [{ name: 'bug' }, { name: 'enhancement' }],
        assignees: [{ login: 'alice' }],
        comments: [
          { author: { login: 'bob' }, body: 'A comment', createdAt: '2024-01-03T00:00:00Z' },
        ],
      });

      const issue = await provider.getIssue(42);

      assertIssueDetailShape(issue);
      expect(issue.number).toBe(42);
      expect(issue.title).toBe('Contract test issue');
      expect(issue.body).toBe('Issue body');
      expect(issue.labels).toEqual(['bug', 'enhancement']);
      expect(issue.assignees).toEqual(['alice']);
      expect(issue.state).toBe('open');
      expect(issue.comments).toHaveLength(1);
      expect(issue.comments[0].author).toBe('bob');
      expect(issue.comments[0].body).toBe('A comment');
      expect(issue.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(issue.updatedAt).toBe('2024-01-02T00:00:00Z');
      expect(issue.linkedPRs).toEqual([]);
    });

    it('normalizes closed state correctly', async () => {
      getGitHubApiMock().getIssue.mockResolvedValue({ number: 1, state: 'closed', comments: [] });

      const issue = await provider.getIssue(1);

      expect(issue.state).toBe('closed');
    });
  });

  describe('AzureDevOpsProvider', () => {
    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns IssueDetail with all required fields', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);

      // Work item response
      fetchStub.mockResolvedValueOnce(okJson({
        id: 42,
        fields: {
          'System.Title': 'ADO Contract issue',
          'System.Description': 'ADO body',
          'System.Tags': 'bug; enhancement',
          'System.AssignedTo': { displayName: 'Alice' },
          'System.State': 'Active',
          'System.CreatedDate': '2024-01-01T00:00:00Z',
          'System.ChangedDate': '2024-01-02T00:00:00Z',
        },
      }));

      // Comments response
      fetchStub.mockResolvedValueOnce(okJson({
        comments: [
          { createdBy: { displayName: 'Bob' }, text: 'A comment', createdDate: '2024-01-03T00:00:00Z' },
        ],
      }));

      const issue = await provider.getIssue(42);

      assertIssueDetailShape(issue);
      expect(issue.number).toBe(42);
      expect(issue.title).toBe('ADO Contract issue');
      expect(issue.body).toBe('ADO body');
      expect(issue.labels).toEqual(['bug', 'enhancement']);
      expect(issue.assignees).toEqual(['Alice']);
      expect(issue.state).toBe('open');
      expect(issue.comments).toHaveLength(1);
      expect(issue.comments[0].author).toBe('Bob');
      expect(issue.comments[0].body).toBe('A comment');
      expect(issue.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(issue.updatedAt).toBe('2024-01-02T00:00:00Z');
      expect(issue.linkedPRs).toEqual([]);
    });

    it('normalizes closed state from ADO terminal states', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({
        id: 1,
        fields: { 'System.State': 'Done' },
      }));
      fetchStub.mockResolvedValueOnce(okJson({ comments: [] }));

      const issue = await provider.getIssue(1);

      expect(issue.state).toBe('closed');
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 2: getPullRequest state is 'open'|'closed'|'merged'
// ══════════════════════════════════════════════════════════════════

describe('Contract: getPullRequest returns PullRequestInfo with valid state', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns state "open" for an open PR', async () => {
      getGitHubApiMock().getPullRequest.mockResolvedValue({
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        title: 'Open PR',
        state: 'open',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        merged: false,
        merged_at: null,
      });

      const pr = await provider.getPullRequest(1);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('open');
    });

    it('returns state "merged" for a merged PR', async () => {
      getGitHubApiMock().getPullRequest.mockResolvedValue({
        number: 2,
        html_url: 'https://github.com/owner/repo/pull/2',
        title: 'Merged PR',
        state: 'closed',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        merged: true,
        merged_at: '2024-01-01T00:00:00Z',
      });

      const pr = await provider.getPullRequest(2);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('merged');
    });

    it('returns state "closed" for a closed unmerged PR', async () => {
      getGitHubApiMock().getPullRequest.mockResolvedValue({
        number: 3,
        html_url: 'https://github.com/owner/repo/pull/3',
        title: 'Closed PR',
        state: 'closed',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        merged: false,
        merged_at: null,
      });

      const pr = await provider.getPullRequest(3);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('closed');
    });
  });

  describe('AzureDevOpsProvider', () => {
    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns state "open" for an active ADO PR', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({
        pullRequestId: 1,
        title: 'Active PR',
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        status: 'active',
      }));

      const pr = await provider.getPullRequest(1);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('open');
    });

    it('returns state "merged" for a completed ADO PR', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({
        pullRequestId: 2,
        title: 'Completed PR',
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        status: 'completed',
      }));

      const pr = await provider.getPullRequest(2);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('merged');
    });

    it('returns state "closed" for an abandoned ADO PR', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({
        pullRequestId: 3,
        title: 'Abandoned PR',
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        status: 'abandoned',
      }));

      const pr = await provider.getPullRequest(3);

      assertPullRequestInfoShape(pr);
      expect(pr.state).toBe('closed');
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 2b: listPullRequests — every element has valid state
// ══════════════════════════════════════════════════════════════════

describe('Contract: listPullRequests returns PullRequestInfo[] with valid states', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('every element has state in {open, closed, merged}', async () => {
      getGitHubApiMock().listPullRequests.mockResolvedValue([
        { number: 1, html_url: 'u1', title: 'Open', state: 'open', head: { ref: 'f' }, base: { ref: 'main' }, merged_at: null },
        { number: 2, html_url: 'u2', title: 'Merged', state: 'closed', head: { ref: 'g' }, base: { ref: 'main' }, merged_at: '2024-01-01T00:00:00Z' },
        { number: 3, html_url: 'u3', title: 'Closed', state: 'closed', head: { ref: 'h' }, base: { ref: 'main' }, merged_at: null },
      ]);

      const prs = await provider.listPullRequests();

      expect(prs.length).toBeGreaterThan(0);
      for (const pr of prs) {
        assertPullRequestInfoShape(pr);
      }
      expect(prs[0].state).toBe('open');
      expect(prs[1].state).toBe('merged');
      expect(prs[2].state).toBe('closed');
    });
  });

  describe('AzureDevOpsProvider', () => {
    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('every element has state in {open, closed, merged}', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({
        value: [
          { pullRequestId: 1, title: 'Open', sourceRefName: 'refs/heads/f', targetRefName: 'refs/heads/main', status: 'active' },
          { pullRequestId: 2, title: 'Merged', sourceRefName: 'refs/heads/g', targetRefName: 'refs/heads/main', status: 'completed' },
          { pullRequestId: 3, title: 'Closed', sourceRefName: 'refs/heads/h', targetRefName: 'refs/heads/main', status: 'abandoned' },
        ],
      }));

      const prs = await provider.listPullRequests();

      expect(prs.length).toBeGreaterThan(0);
      for (const pr of prs) {
        assertPullRequestInfoShape(pr);
      }
      expect(prs[0].state).toBe('open');
      expect(prs[1].state).toBe('merged');
      expect(prs[2].state).toBe('closed');
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 2c: findOpenPR returns PullRequestInfo or null
// ══════════════════════════════════════════════════════════════════

describe('Contract: findOpenPR returns matching PullRequestInfo or null', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns matching PullRequestInfo when an open PR exists for the given branch', async () => {
      getGitHubApiMock().listPullRequests.mockResolvedValue([
        {
          number: 10,
          html_url: 'https://github.com/owner/repo/pull/10',
          title: 'Feature PR',
          state: 'open',
          head: { ref: 'feature-branch' },
          base: { ref: 'main' },
          merged_at: null,
        },
      ]);

      const pr = await provider.findOpenPR(1, 'feature-branch');

      expect(pr).not.toBeNull();
      assertPullRequestInfoShape(pr!);
      expect(pr!.headBranch).toBe('feature-branch');
      expect(pr!.state).toBe('open');
    });

    it('returns null when no open PR exists for the given branch', async () => {
      getGitHubApiMock().listPullRequests.mockResolvedValue([]);

      const pr = await provider.findOpenPR(1, 'non-existent-branch');

      expect(pr).toBeNull();
    });
  });

  describe('AzureDevOpsProvider', () => {
    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns matching PullRequestInfo when an open PR exists for the given branch', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({
        value: [
          {
            pullRequestId: 10,
            title: 'Feature PR',
            sourceRefName: 'refs/heads/feature-branch',
            targetRefName: 'refs/heads/main',
            status: 'active',
          },
        ],
      }));

      const pr = await provider.findOpenPR(1, 'feature-branch');

      expect(pr).not.toBeNull();
      assertPullRequestInfoShape(pr!);
      expect(pr!.headBranch).toBe('feature-branch');
      expect(pr!.state).toBe('open');
    });

    it('returns null when no open PR exists for the given branch', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      const pr = await provider.findOpenPR(1, 'non-existent-branch');

      expect(pr).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 3a: applyLabels is additive and deduplicates
// ══════════════════════════════════════════════════════════════════

describe('Contract: applyLabels is additive and does not introduce duplicates', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('is additive: calling twice with different labels issues two separate API calls (neither replaces the other)', async () => {
      // GitHub uses the addLabels endpoint (not replaceLabels) which is additive by design.
      // Each applyLabels call appends; existing labels are preserved.
      getGitHubApiMock().applyLabels.mockResolvedValue(undefined);

      await provider.applyLabels(1, ['bug']);
      await provider.applyLabels(1, ['enhancement']);

      expect(getGitHubApiMock().applyLabels).toHaveBeenCalledTimes(2);
      expect(getGitHubApiMock().applyLabels).toHaveBeenNthCalledWith(1, 1, ['bug']);
      expect(getGitHubApiMock().applyLabels).toHaveBeenNthCalledWith(2, 1, ['enhancement']);
    });

    it('does not throw when called with duplicate labels (deduplication is handled by the GitHub API)', async () => {
      // GitHub's addLabels endpoint is idempotent: adding an already-present label is a no-op.
      getGitHubApiMock().applyLabels.mockResolvedValue(undefined);

      await expect(
        provider.applyLabels(1, ['bug', 'bug', 'enhancement']),
      ).resolves.not.toThrow();
    });
  });

  describe('AzureDevOpsProvider', () => {
    // PROVIDER DEVIATION: AzureDevOpsProvider.applyLabels is a no-op stub.
    // Label management on Azure DevOps is not yet implemented.
    // The contract guarantee (additive, no duplicates) trivially holds.

    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not throw when called twice with different labels', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);

      await expect(provider.applyLabels(1, ['bug'])).resolves.not.toThrow();
      await expect(provider.applyLabels(1, ['enhancement'])).resolves.not.toThrow();
    });

    it('does not throw when called with duplicate labels', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);

      await expect(provider.applyLabels(1, ['bug', 'bug'])).resolves.not.toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 3b: listPRComments returns PRComment[]
// ══════════════════════════════════════════════════════════════════

describe('Contract: listPRComments returns PRComment[] with required fields', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns PRComment[] with id, author, isBot, body, createdAt, url fields', async () => {
      getGitHubApiMock().getPRComments.mockResolvedValue([
        {
          id: 101,
          user: { login: 'alice', type: 'User' },
          body: 'Great work!',
          created_at: '2024-01-01T00:00:00Z',
          html_url: 'https://github.com/owner/repo/pull/1#issuecomment-101',
        },
        {
          id: 102,
          user: { login: 'codecov[bot]', type: 'Bot' },
          body: 'Coverage 95%.',
          created_at: '2024-01-02T00:00:00Z',
          html_url: 'https://github.com/owner/repo/pull/1#issuecomment-102',
        },
      ]);

      const comments: PRComment[] = await provider.listPRComments(1);

      expect(Array.isArray(comments)).toBe(true);
      expect(comments).toHaveLength(2);

      for (const c of comments) {
        expect(typeof c.id).toBe('string');
        expect(typeof c.author).toBe('string');
        expect(typeof c.isBot).toBe('boolean');
        expect(typeof c.body).toBe('string');
        expect(typeof c.createdAt).toBe('string');
        expect(typeof c.url).toBe('string');
      }

      expect(comments[0].author).toBe('alice');
      expect(comments[0].isBot).toBe(false);
      expect(comments[1].author).toBe('codecov[bot]');
      expect(comments[1].isBot).toBe(true);
    });
  });

  describe('AzureDevOpsProvider', () => {
    // PROVIDER DEVIATION: AzureDevOpsProvider.listPRComments always returns [].
    // PR comment retrieval is not yet implemented for Azure DevOps.

    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns an empty array (listPRComments not yet implemented on Azure DevOps)', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      const comments = await provider.listPRComments(1);

      expect(Array.isArray(comments)).toBe(true);
      expect(comments).toHaveLength(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 3c: listPRReviews returns PRReview[]
// ══════════════════════════════════════════════════════════════════

describe('Contract: listPRReviews returns PRReview[] with required fields', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns PRReview[] with id, author, isBot, body, state, submittedAt fields', async () => {
      getGitHubApiMock().getPRReviews.mockResolvedValue([
        {
          id: 201,
          user: { login: 'alice', type: 'User' },
          body: 'LGTM',
          state: 'APPROVED',
          submitted_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 202,
          user: { login: 'review-bot[bot]', type: 'Bot' },
          body: '',
          state: 'COMMENTED',
          submitted_at: '2024-01-02T00:00:00Z',
        },
      ]);

      const reviews: PRReview[] = await provider.listPRReviews(1);

      expect(Array.isArray(reviews)).toBe(true);
      expect(reviews).toHaveLength(2);

      for (const r of reviews) {
        expect(typeof r.id).toBe('string');
        expect(typeof r.author).toBe('string');
        expect(typeof r.isBot).toBe('boolean');
        expect(typeof r.body).toBe('string');
        expect(typeof r.state).toBe('string');
        expect(typeof r.submittedAt).toBe('string');
      }

      expect(reviews[0].author).toBe('alice');
      expect(reviews[0].isBot).toBe(false);
      expect(reviews[0].state).toBe('APPROVED');
      expect(reviews[1].author).toBe('review-bot[bot]');
      expect(reviews[1].isBot).toBe(true);
    });
  });

  describe('AzureDevOpsProvider', () => {
    // PROVIDER DEVIATION: AzureDevOpsProvider.listPRReviews always returns [].
    // PR review retrieval is not yet implemented for Azure DevOps.

    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns an empty array (listPRReviews not yet implemented on Azure DevOps)', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      const reviews = await provider.listPRReviews(1);

      expect(Array.isArray(reviews)).toBe(true);
      expect(reviews).toHaveLength(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// CONTRACT SUITE 3d: listPRReviewComments returns ReviewThread[]
// ══════════════════════════════════════════════════════════════════

describe('Contract: listPRReviewComments returns ReviewThread[] with required fields', () => {
  describe('GitHubProvider', () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      provider = new GitHubProvider('owner/repo', mockLogger);
      await provider.connect();
    });

    it('returns ReviewThread[] with id, prNumber, isResolved, isOutdated, comments fields', async () => {
      getGitHubApiMock().getPRReviewComments.mockResolvedValue([
        {
          id: 't1',
          isResolved: false,
          isOutdated: false,
          comments: [
            {
              id: 'c1',
              author: { login: 'alice' },
              body: 'Consider refactoring.',
              createdAt: '2024-01-01T00:00:00Z',
              path: 'src/index.ts',
              line: 42,
            },
          ],
        },
      ]);

      const threads: ReviewThread[] = await provider.listPRReviewComments(1);

      expect(Array.isArray(threads)).toBe(true);
      expect(threads).toHaveLength(1);

      const [thread] = threads;
      expect(typeof thread.id).toBe('string');
      expect(typeof thread.prNumber).toBe('number');
      expect(typeof thread.isResolved).toBe('boolean');
      expect(typeof thread.isOutdated).toBe('boolean');
      expect(Array.isArray(thread.comments)).toBe(true);
      expect(thread.prNumber).toBe(1);
      expect(thread.isResolved).toBe(false);
      expect(thread.isOutdated).toBe(false);

      const [comment] = thread.comments;
      expect(typeof comment.id).toBe('string');
      expect(typeof comment.author).toBe('string');
      expect(typeof comment.body).toBe('string');
      expect(typeof comment.createdAt).toBe('string');
      expect(typeof comment.path).toBe('string');
    });
  });

  describe('AzureDevOpsProvider', () => {
    // PROVIDER DEVIATION: AzureDevOpsProvider.listPRReviewComments always returns [].
    // Review-response mode (inline thread retrieval) is not yet implemented on Azure DevOps.
    // GitHubProvider correctly maps GitHub review threads to ReviewThread[].

    let fetchStub: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns an empty array (listPRReviewComments not yet implemented on Azure DevOps)', async () => {
      const provider = await makeConnectedAdoProvider(fetchStub);
      const threads = await provider.listPRReviewComments(1);

      expect(Array.isArray(threads)).toBe(true);
      expect(threads).toHaveLength(0);
    });
  });
});
