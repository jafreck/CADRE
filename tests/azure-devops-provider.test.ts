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
