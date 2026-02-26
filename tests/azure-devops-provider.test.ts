import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';
import type { Logger } from '../src/logging/logger.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function makeProvider(repositoryName?: string): AzureDevOpsProvider {
  return new AzureDevOpsProvider(
    {
      organization: 'my-org',
      project: 'my-project',
      repositoryName,
      auth: { pat: 'secret-pat' },
      apiVersion: '7.1',
    },
    mockLogger,
  );
}

/** Returns a pre-connected provider with fetch already stubbed. */
async function makeConnectedProvider(
  fetchStub: ReturnType<typeof vi.fn>,
  repositoryName?: string,
): Promise<AzureDevOpsProvider> {
  // First call: checkAuth during connect()
  fetchStub.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: 'proj-id', name: 'my-project' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const provider = makeProvider(repositoryName);
  await provider.connect();
  return provider;
}

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, { status });
}

describe('AzureDevOpsProvider.createPullRequest()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('basic PR creation', () => {
    it('should create a PR and return PullRequestInfo', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(
        okJson({ pullRequestId: 101 }),
      );

      const result = await provider.createPullRequest({
        title: 'My PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      expect(result.number).toBe(101);
      expect(result.title).toBe('My PR');
      expect(result.headBranch).toBe('feature-branch');
      expect(result.baseBranch).toBe('main');
      expect(result.url).toContain('101');
    });

    it('should POST to the correct PR creation URL', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 101 }));

      await provider.createPullRequest({
        title: 'My PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      const prCallArgs = fetchStub.mock.calls[1];
      expect(prCallArgs[0]).toContain(
        'my-org/my-project/_apis/git/repositories/my-project/pullrequests',
      );
      expect(prCallArgs[1].method).toBe('POST');
    });

    it('should use repositoryName when provided', async () => {
      const provider = await makeConnectedProvider(fetchStub, 'custom-repo');

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 55 }));

      await provider.createPullRequest({
        title: 'My PR',
        body: '',
        head: 'main',
        base: 'main',
      });

      const prCallArgs = fetchStub.mock.calls[1];
      expect(prCallArgs[0]).toContain('/repositories/custom-repo/');
    });

    it('should include isDraft in body when draft is true', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 102 }));

      await provider.createPullRequest({
        title: 'Draft PR',
        body: '',
        head: 'dev',
        base: 'main',
        draft: true,
      });

      const prCallArgs = fetchStub.mock.calls[1];
      const body = JSON.parse(prCallArgs[1].body as string);
      expect(body.isDraft).toBe(true);
    });

    it('should not include isDraft in body when draft is false', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 103 }));

      await provider.createPullRequest({
        title: 'Normal PR',
        body: '',
        head: 'dev',
        base: 'main',
        draft: false,
      });

      const prCallArgs = fetchStub.mock.calls[1];
      const body = JSON.parse(prCallArgs[1].body as string);
      expect(body.isDraft).toBeUndefined();
    });

    it('should throw when not connected', async () => {
      const provider = makeProvider();
      vi.stubGlobal('fetch', fetchStub);

      await expect(
        provider.createPullRequest({
          title: 'PR',
          body: '',
          head: 'branch',
          base: 'main',
        }),
      ).rejects.toThrow('not connected');
    });
  });

  describe('label forwarding', () => {
    it('should POST each label to the ADO labels endpoint', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      // PR creation
      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 200 }));
      // Label 1
      fetchStub.mockResolvedValueOnce(okJson({}));
      // Label 2
      fetchStub.mockResolvedValueOnce(okJson({}));

      await provider.createPullRequest({
        title: 'PR with labels',
        body: '',
        head: 'feature',
        base: 'main',
        labels: ['bug', 'enhancement'],
      });

      const labelCall1 = fetchStub.mock.calls[2];
      const labelCall2 = fetchStub.mock.calls[3];

      expect(labelCall1[0]).toContain('/pullrequests/200/labels');
      expect(labelCall1[1].method).toBe('POST');
      expect(JSON.parse(labelCall1[1].body as string)).toEqual({ name: 'bug' });

      expect(labelCall2[0]).toContain('/pullrequests/200/labels');
      expect(labelCall2[1].method).toBe('POST');
      expect(JSON.parse(labelCall2[1].body as string)).toEqual({ name: 'enhancement' });
    });

    it('should not make any label API calls when labels is undefined', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 201 }));

      await provider.createPullRequest({
        title: 'PR without labels',
        body: '',
        head: 'feature',
        base: 'main',
      });

      // Only 2 calls: checkAuth + PR creation
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('should not make any label API calls when labels is empty', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 202 }));

      await provider.createPullRequest({
        title: 'PR with empty labels',
        body: '',
        head: 'feature',
        base: 'main',
        labels: [],
      });

      // Only 2 calls: checkAuth + PR creation
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('should not throw when a label API call fails (non-critical)', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 203 }));
      // Label call fails
      fetchStub.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(
        provider.createPullRequest({
          title: 'PR',
          body: '',
          head: 'feature',
          base: 'main',
          labels: ['blocked'],
        }),
      ).resolves.toMatchObject({ number: 203 });
    });

    it('should log a warning when a label API call fails', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 204 }));
      fetchStub.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        labels: ['cadre-generated'],
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set label "cadre-generated"'),
      );
    });

    it('should continue setting remaining labels after one failure', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 205 }));
      // First label fails
      fetchStub.mockResolvedValueOnce(errorResponse(500, 'Error'));
      // Second label succeeds
      fetchStub.mockResolvedValueOnce(okJson({}));

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        labels: ['label-1', 'label-2'],
      });

      // 4 calls: checkAuth + PR + label1 + label2
      expect(fetchStub).toHaveBeenCalledTimes(4);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('reviewer forwarding', () => {
    it('should resolve reviewer identity and PUT to reviewers endpoint', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 300 }));
      // Identity lookup for alice
      fetchStub.mockResolvedValueOnce(
        okJson({ value: [{ id: 'alice-guid-123' }] }),
      );
      // PUT reviewer
      fetchStub.mockResolvedValueOnce(okJson({}));

      await provider.createPullRequest({
        title: 'PR with reviewer',
        body: '',
        head: 'feature',
        base: 'main',
        reviewers: ['alice@example.com'],
      });

      // Identity lookup call
      const identityCall = fetchStub.mock.calls[2];
      expect(identityCall[0]).toContain('vssps.dev.azure.com/my-org/_apis/identities');
      expect(identityCall[0]).toContain('alice%40example.com');

      // Reviewer PUT call
      const reviewerCall = fetchStub.mock.calls[3];
      expect(reviewerCall[0]).toContain('/pullrequests/300/reviewers/alice-guid-123');
      expect(reviewerCall[1].method).toBe('PUT');
      expect(JSON.parse(reviewerCall[1].body as string)).toEqual({
        id: 'alice-guid-123',
        vote: 0,
      });
    });

    it('should not make any reviewer API calls when reviewers is undefined', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 301 }));

      await provider.createPullRequest({
        title: 'PR without reviewers',
        body: '',
        head: 'feature',
        base: 'main',
      });

      // Only 2 calls: checkAuth + PR creation
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('should not make any reviewer API calls when reviewers is empty', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 302 }));

      await provider.createPullRequest({
        title: 'PR with empty reviewers',
        body: '',
        head: 'feature',
        base: 'main',
        reviewers: [],
      });

      // Only 2 calls: checkAuth + PR creation
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('should not throw when reviewer identity is not found (non-critical)', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 303 }));
      // Identity lookup returns empty
      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      await expect(
        provider.createPullRequest({
          title: 'PR',
          body: '',
          head: 'feature',
          base: 'main',
          reviewers: ['unknown@example.com'],
        }),
      ).resolves.toMatchObject({ number: 303 });
    });

    it('should log a warning when reviewer identity is not found', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 304 }));
      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        reviewers: ['ghost@example.com'],
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not resolve reviewer "ghost@example.com"'),
      );
    });

    it('should not throw when reviewer PUT API call fails (non-critical)', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 305 }));
      fetchStub.mockResolvedValueOnce(okJson({ value: [{ id: 'guid-abc' }] }));
      // Reviewer PUT fails
      fetchStub.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(
        provider.createPullRequest({
          title: 'PR',
          body: '',
          head: 'feature',
          base: 'main',
          reviewers: ['reviewer@example.com'],
        }),
      ).resolves.toMatchObject({ number: 305 });
    });

    it('should log a warning when reviewer PUT API call fails', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 306 }));
      fetchStub.mockResolvedValueOnce(okJson({ value: [{ id: 'guid-xyz' }] }));
      fetchStub.mockResolvedValueOnce(errorResponse(500, 'Error'));

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        reviewers: ['bob@example.com'],
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to add reviewer "bob@example.com"'),
      );
    });

    it('should continue adding remaining reviewers after one failure', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 307 }));
      // alice: identity found, PUT fails
      fetchStub.mockResolvedValueOnce(okJson({ value: [{ id: 'alice-id' }] }));
      fetchStub.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));
      // bob: identity found, PUT succeeds
      fetchStub.mockResolvedValueOnce(okJson({ value: [{ id: 'bob-id' }] }));
      fetchStub.mockResolvedValueOnce(okJson({}));

      await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        reviewers: ['alice@example.com', 'bob@example.com'],
      });

      // 6 calls: checkAuth + PR + alice identity + alice PUT + bob identity + bob PUT
      expect(fetchStub).toHaveBeenCalledTimes(6);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('should not make reviewer PUT call when identity lookup fails with exception', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 308 }));
      // Identity lookup throws network error
      fetchStub.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.createPullRequest({
          title: 'PR',
          body: '',
          head: 'feature',
          base: 'main',
          reviewers: ['alice@example.com'],
        }),
      ).resolves.toMatchObject({ number: 308 });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to add reviewer "alice@example.com"'),
      );
      // Only 3 calls: checkAuth + PR creation + identity lookup
      expect(fetchStub).toHaveBeenCalledTimes(3);
    });
  });

  describe('findOpenPR()', () => {
    it('should return a matching PR when one exists for the branch', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(
        okJson({
          value: [
            {
              pullRequestId: 42,
              title: 'Fix issue',
              sourceRefName: 'refs/heads/cadre/issue-1-fix',
              targetRefName: 'refs/heads/main',
            },
          ],
        }),
      );

      const result = await provider.findOpenPR(1, 'cadre/issue-1-fix');

      expect(result).not.toBeNull();
      expect(result!.number).toBe(42);
      expect(result!.headBranch).toBe('cadre/issue-1-fix');
    });

    it('should return null when no PRs exist', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      const result = await provider.findOpenPR(1, 'cadre/issue-1-fix');

      expect(result).toBeNull();
    });

    it('should return null when no PR matches the branch', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(
        okJson({
          value: [
            {
              pullRequestId: 99,
              title: 'Other PR',
              sourceRefName: 'refs/heads/other-branch',
              targetRefName: 'refs/heads/main',
            },
          ],
        }),
      );

      const result = await provider.findOpenPR(1, 'cadre/issue-1-fix');

      expect(result).toBeNull();
    });

    it('should call listPullRequests with head=branch and state=open', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      await provider.findOpenPR(7, 'my-feature-branch');

      const listCall = fetchStub.mock.calls[1];
      expect(listCall[0]).toContain('searchCriteria.sourceRefName=refs%2Fheads%2Fmy-feature-branch');
      expect(listCall[0]).toContain('searchCriteria.status=active');
    });

    it('should return the first matching PR when multiple PRs are returned', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(
        okJson({
          value: [
            {
              pullRequestId: 10,
              title: 'First PR',
              sourceRefName: 'refs/heads/target-branch',
              targetRefName: 'refs/heads/main',
            },
            {
              pullRequestId: 11,
              title: 'Second PR',
              sourceRefName: 'refs/heads/target-branch',
              targetRefName: 'refs/heads/main',
            },
          ],
        }),
      );

      const result = await provider.findOpenPR(5, 'target-branch');

      expect(result).not.toBeNull();
      expect(result!.number).toBe(10);
    });

    it('should throw when not connected', async () => {
      const provider = makeProvider();
      vi.stubGlobal('fetch', fetchStub);

      await expect(provider.findOpenPR(1, 'branch')).rejects.toThrow('not connected');
    });
  });

  describe('listPRReviewComments()', () => {
    it('should return an empty array (stub)', async () => {
      const provider = await makeConnectedProvider(fetchStub);
      const result = await provider.listPRReviewComments(1);
      expect(result).toEqual([]);
    });

    it('should log a warning when called', async () => {
      const provider = await makeConnectedProvider(fetchStub);
      await provider.listPRReviewComments(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not yet supported on Azure DevOps'),
      );
    });
  });

  describe('combined labels and reviewers', () => {
    it('should set labels and add reviewers when both are provided', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 400 }));
      // Label call
      fetchStub.mockResolvedValueOnce(okJson({}));
      // Reviewer: identity lookup + PUT
      fetchStub.mockResolvedValueOnce(okJson({ value: [{ id: 'reviewer-id' }] }));
      fetchStub.mockResolvedValueOnce(okJson({}));

      const result = await provider.createPullRequest({
        title: 'Full PR',
        body: '',
        head: 'feature',
        base: 'main',
        labels: ['cadre-generated'],
        reviewers: ['dev@example.com'],
      });

      expect(result.number).toBe(400);
      // 5 calls: checkAuth + PR + label + identity + reviewer PUT
      expect(fetchStub).toHaveBeenCalledTimes(5);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should still return PR info when both labels and reviewers fail', async () => {
      const provider = await makeConnectedProvider(fetchStub);

      fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 401 }));
      // Label fails
      fetchStub.mockResolvedValueOnce(errorResponse(500, 'Error'));
      // Reviewer identity not found
      fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

      const result = await provider.createPullRequest({
        title: 'PR',
        body: '',
        head: 'feature',
        base: 'main',
        labels: ['my-label'],
        reviewers: ['unknown@example.com'],
      });

      expect(result.number).toBe(401);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listIssues
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.listIssues()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses NOT IN condition for state: "open"', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    // WIQL result with no IDs → easy to test without extra mocks
    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open' });

    const wiqlCall = fetchStub.mock.calls[1];
    const body = JSON.parse(wiqlCall[1].body as string) as { query: string };
    expect(body.query).toContain(`NOT IN ('Closed', 'Done', 'Resolved', 'Removed')`);
  });

  it('uses IN condition for state: "closed"', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'closed' });

    const wiqlCall = fetchStub.mock.calls[1];
    const body = JSON.parse(wiqlCall[1].body as string) as { query: string };
    expect(body.query).toContain(`IN ('Closed', 'Done', 'Resolved')`);
  });

  it('adds a Tags Contains condition for each label', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open', labels: ['bug', 'help-wanted'] });

    const wiqlCall = fetchStub.mock.calls[1];
    const body = JSON.parse(wiqlCall[1].body as string) as { query: string };
    expect(body.query).toContain(`[System.Tags] Contains 'bug'`);
    expect(body.query).toContain(`[System.Tags] Contains 'help-wanted'`);
  });

  it('adds an IterationPath UNDER condition for milestone', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open', milestone: 'Sprint 5' });

    const wiqlCall = fetchStub.mock.calls[1];
    const body = JSON.parse(wiqlCall[1].body as string) as { query: string };
    expect(body.query).toContain(`[System.IterationPath] UNDER 'my-project\\Sprint 5'`);
  });

  it('adds an AssignedTo condition for assignee', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open', assignee: 'alice@example.com' });

    const wiqlCall = fetchStub.mock.calls[1];
    const body = JSON.parse(wiqlCall[1].body as string) as { query: string };
    expect(body.query).toContain(`[System.AssignedTo] = 'alice@example.com'`);
  });

  it('returns empty array when WIQL result has no work item IDs', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    const result = await provider.listIssues({ state: 'open' });

    expect(result).toEqual([]);
    // Only 2 total calls: checkAuth + WIQL (no batch fetch)
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('batch-fetches work items when IDs are returned by WIQL', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    // WIQL returns two IDs
    fetchStub.mockResolvedValueOnce(okJson({ workItems: [{ id: 1 }, { id: 2 }] }));
    // Batch fetch
    fetchStub.mockResolvedValueOnce(
      okJson({
        value: [
          {
            id: 1,
            fields: {
              'System.Title': 'Bug fix',
              'System.State': 'Active',
              'System.Description': '',
              'System.Tags': '',
              'System.CreatedDate': '2024-01-01',
              'System.ChangedDate': '2024-01-02',
            },
          },
          {
            id: 2,
            fields: {
              'System.Title': 'Feature work',
              'System.State': 'Active',
              'System.Description': '',
              'System.Tags': '',
              'System.CreatedDate': '2024-01-01',
              'System.ChangedDate': '2024-01-02',
            },
          },
        ],
      }),
    );

    const result = await provider.listIssues({ state: 'open' });

    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(1);
    expect(result[0].title).toBe('Bug fix');
    expect(result[1].number).toBe(2);
    // 3 total calls: checkAuth + WIQL + batch
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('passes $top=limit to the WIQL endpoint', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open', limit: 5 });

    const wiqlCall = fetchStub.mock.calls[1];
    expect(wiqlCall[0]).toContain('$top=5');
  });

  it('defaults limit to 30 when not specified', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open' });

    const wiqlCall = fetchStub.mock.calls[1];
    expect(wiqlCall[0]).toContain('$top=30');
  });

  it('POSTs to the WIQL endpoint', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ workItems: [] }));

    await provider.listIssues({ state: 'open' });

    const wiqlCall = fetchStub.mock.calls[1];
    expect(wiqlCall[0]).toContain('_apis/wit/wiql');
    expect(wiqlCall[1].method).toBe('POST');
  });

  it('throws when not connected', async () => {
    const provider = makeProvider();
    vi.stubGlobal('fetch', fetchStub);

    await expect(provider.listIssues({ state: 'open' })).rejects.toThrow('not connected');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getPullRequest
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.getPullRequest()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs from the correct PR URL', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(
      okJson({
        pullRequestId: 77,
        title: 'My PR',
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
      }),
    );

    await provider.getPullRequest(77);

    const getCall = fetchStub.mock.calls[1];
    expect(getCall[0]).toContain('/pullrequests/77');
    expect(getCall[1]?.method ?? 'GET').toBe('GET');
  });

  it('maps response fields to PullRequestInfo correctly', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(
      okJson({
        pullRequestId: 42,
        title: 'Fix everything',
        sourceRefName: 'refs/heads/cadre/issue-42',
        targetRefName: 'refs/heads/develop',
      }),
    );

    const result = await provider.getPullRequest(42);

    expect(result.number).toBe(42);
    expect(result.title).toBe('Fix everything');
    expect(result.headBranch).toBe('cadre/issue-42');
    expect(result.baseBranch).toBe('develop');
    expect(result.url).toContain('42');
  });

  it('throws when not connected', async () => {
    const provider = makeProvider();
    vi.stubGlobal('fetch', fetchStub);

    await expect(provider.getPullRequest(1)).rejects.toThrow('not connected');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listPullRequests
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.listPullRequests()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns mapped PullRequestInfo for each PR in the response', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(
      okJson({
        value: [
          {
            pullRequestId: 10,
            title: 'PR one',
            sourceRefName: 'refs/heads/feature-a',
            targetRefName: 'refs/heads/main',
          },
          {
            pullRequestId: 11,
            title: 'PR two',
            sourceRefName: 'refs/heads/feature-b',
            targetRefName: 'refs/heads/main',
          },
        ],
      }),
    );

    const result = await provider.listPullRequests();

    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(10);
    expect(result[0].headBranch).toBe('feature-a');
    expect(result[1].number).toBe(11);
  });

  it('filters by source branch when head is provided', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

    await provider.listPullRequests({ head: 'my-feature' });

    const listCall = fetchStub.mock.calls[1];
    expect(listCall[0]).toContain('searchCriteria.sourceRefName=refs%2Fheads%2Fmy-feature');
  });

  it('maps state "open" to ADO status "active"', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

    await provider.listPullRequests({ state: 'open' });

    const listCall = fetchStub.mock.calls[1];
    expect(listCall[0]).toContain('searchCriteria.status=active');
  });

  it('maps state "closed" to ADO status "abandoned"', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

    await provider.listPullRequests({ state: 'closed' });

    const listCall = fetchStub.mock.calls[1];
    expect(listCall[0]).toContain('searchCriteria.status=abandoned');
  });

  it('maps state "merged" to ADO status "completed"', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

    await provider.listPullRequests({ state: 'merged' });

    const listCall = fetchStub.mock.calls[1];
    expect(listCall[0]).toContain('searchCriteria.status=completed');
  });

  it('returns empty array when API returns no PRs', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ value: [] }));

    const result = await provider.listPullRequests();

    expect(result).toEqual([]);
  });

  it('throws when not connected', async () => {
    const provider = makeProvider();
    vi.stubGlobal('fetch', fetchStub);

    await expect(provider.listPullRequests()).rejects.toThrow('not connected');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updatePullRequest
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.updatePullRequest()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCHes the PR URL with title and description', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({}));

    await provider.updatePullRequest(99, { title: 'Updated title', body: 'New description' });

    const patchCall = fetchStub.mock.calls[1];
    expect(patchCall[0]).toContain('/pullrequests/99');
    expect(patchCall[1].method).toBe('PATCH');
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.title).toBe('Updated title');
    expect(body.description).toBe('New description');
  });

  it('sends only title when body is omitted', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({}));

    await provider.updatePullRequest(99, { title: 'Just title' });

    const patchCall = fetchStub.mock.calls[1];
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.title).toBe('Just title');
    expect(body.description).toBeUndefined();
  });

  it('throws when not connected', async () => {
    const provider = makeProvider();
    vi.stubGlobal('fetch', fetchStub);

    await expect(provider.updatePullRequest(1, { title: 'x' })).rejects.toThrow('not connected');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listPRComments / listPRReviews (stubs)
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.listPRComments()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty array', async () => {
    const provider = await makeConnectedProvider(fetchStub);
    const result = await provider.listPRComments(1);
    expect(result).toEqual([]);
  });

  it('logs a warning when called', async () => {
    const provider = await makeConnectedProvider(fetchStub);
    await provider.listPRComments(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not yet supported on Azure DevOps'),
    );
  });
});

describe('AzureDevOpsProvider.listPRReviews()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty array', async () => {
    const provider = await makeConnectedProvider(fetchStub);
    const result = await provider.listPRReviews(1);
    expect(result).toEqual([]);
  });

  it('logs a warning when called', async () => {
    const provider = await makeConnectedProvider(fetchStub);
    await provider.listPRReviews(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not yet supported on Azure DevOps'),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mergePullRequest
// ──────────────────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider.mergePullRequest()', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch the PR then PATCH with status completed', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    const lastMergeSourceCommit = { commitId: 'abc123', url: 'https://example.com' };
    // First call: GET PR to retrieve lastMergeSourceCommit
    fetchStub.mockResolvedValueOnce(okJson({ lastMergeSourceCommit }));
    // Second call: PATCH to complete the PR
    fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 55, status: 'completed' }));

    await provider.mergePullRequest(55, 'main');

    // Verify the GET call
    const getCall = fetchStub.mock.calls[1];
    expect(getCall[0]).toContain('/pullrequests/55');
    expect(getCall[1]?.method ?? 'GET').toBe('GET');

    // Verify the PATCH call
    const patchCall = fetchStub.mock.calls[2];
    expect(patchCall[0]).toContain('/pullrequests/55');
    expect(patchCall[1].method).toBe('PATCH');

    const body = JSON.parse(patchCall[1].body as string);
    expect(body.status).toBe('completed');
    expect(body.lastMergeSourceCommit).toEqual(lastMergeSourceCommit);
    expect(body.completionOptions.mergeStrategy).toBe('noFastForward');
  });

  it('should use repositoryName when provided', async () => {
    const provider = await makeConnectedProvider(fetchStub, 'custom-repo');

    fetchStub.mockResolvedValueOnce(okJson({ lastMergeSourceCommit: null }));
    fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 10, status: 'completed' }));

    await provider.mergePullRequest(10, 'main');

    const patchCall = fetchStub.mock.calls[2];
    expect(patchCall[0]).toContain('/repositories/custom-repo/pullrequests/10');
  });

  it('should fall back to project name as repository when repositoryName is omitted', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ lastMergeSourceCommit: null }));
    fetchStub.mockResolvedValueOnce(okJson({ pullRequestId: 20, status: 'completed' }));

    await provider.mergePullRequest(20, 'main');

    const patchCall = fetchStub.mock.calls[2];
    expect(patchCall[0]).toContain('/repositories/my-project/pullrequests/20');
  });

  it('should throw when not connected', async () => {
    const provider = makeProvider();

    await expect(provider.mergePullRequest(1, 'main')).rejects.toThrow('not connected');
  });

  it('should propagate fetch errors from the GET call', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(provider.mergePullRequest(99, 'main')).rejects.toThrow('Azure DevOps API error');
  });

  it('should propagate fetch errors from the PATCH call', async () => {
    const provider = await makeConnectedProvider(fetchStub);

    fetchStub.mockResolvedValueOnce(okJson({ lastMergeSourceCommit: { commitId: 'xyz' } }));
    fetchStub.mockResolvedValueOnce(new Response('Conflict', { status: 409 }));

    await expect(provider.mergePullRequest(77, 'main')).rejects.toThrow('Azure DevOps API error');
  });
});
