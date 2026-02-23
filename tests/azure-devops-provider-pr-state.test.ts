import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

const adoConfig = {
  organization: 'my-org',
  project: 'my-project',
  auth: { pat: 'test-token' },
};

function makeProvider() {
  return new AzureDevOpsProvider(adoConfig, mockLogger);
}

function mockFetch(...responses: object[]) {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    const body = responses[call] ?? responses[responses.length - 1];
    call++;
    return {
      ok: true,
      json: async () => body,
    };
  }));
}

const authResponse = { id: 'proj-id', name: 'my-project' };

const repoName = adoConfig.project;
function prUrl(prId: number) {
  return `https://dev.azure.com/${adoConfig.organization}/${adoConfig.project}/_git/${repoName}/pullrequest/${prId}`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AzureDevOpsProvider – getPullRequest state and merged', () => {
  let provider: AzureDevOpsProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = makeProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns state "open" and merged false when ADO status is "active"', async () => {
    mockFetch(authResponse, {
      pullRequestId: 1,
      title: 'Active PR',
      sourceRefName: 'refs/heads/feature',
      targetRefName: 'refs/heads/main',
      status: 'active',
    });

    await provider.connect();
    const pr = await provider.getPullRequest(1);

    expect(pr.state).toBe('open');
    expect(pr.merged).toBe(false);
  });

  it('returns state "closed" and merged true when ADO status is "completed"', async () => {
    mockFetch(authResponse, {
      pullRequestId: 2,
      title: 'Completed PR',
      sourceRefName: 'refs/heads/feature',
      targetRefName: 'refs/heads/main',
      status: 'completed',
    });

    await provider.connect();
    const pr = await provider.getPullRequest(2);

    expect(pr.state).toBe('closed');
    expect(pr.merged).toBe(true);
  });

  it('returns state "closed" and merged false when ADO status is "abandoned"', async () => {
    mockFetch(authResponse, {
      pullRequestId: 3,
      title: 'Abandoned PR',
      sourceRefName: 'refs/heads/feature',
      targetRefName: 'refs/heads/main',
      status: 'abandoned',
    });

    await provider.connect();
    const pr = await provider.getPullRequest(3);

    expect(pr.state).toBe('closed');
    expect(pr.merged).toBe(false);
  });

  it('returns correct number, url, title, headBranch, baseBranch', async () => {
    mockFetch(authResponse, {
      pullRequestId: 42,
      title: 'My PR',
      sourceRefName: 'refs/heads/cadre/issue-42',
      targetRefName: 'refs/heads/main',
      status: 'active',
    });

    await provider.connect();
    const pr = await provider.getPullRequest(42);

    expect(pr.number).toBe(42);
    expect(pr.url).toBe(prUrl(42));
    expect(pr.title).toBe('My PR');
    expect(pr.headBranch).toBe('cadre/issue-42');
    expect(pr.baseBranch).toBe('main');
  });

  it('strips refs/heads/ prefix from branch names', async () => {
    mockFetch(authResponse, {
      pullRequestId: 5,
      title: 'PR',
      sourceRefName: 'refs/heads/my-feature-branch',
      targetRefName: 'refs/heads/develop',
      status: 'active',
    });

    await provider.connect();
    const pr = await provider.getPullRequest(5);

    expect(pr.headBranch).toBe('my-feature-branch');
    expect(pr.baseBranch).toBe('develop');
  });
});

describe('AzureDevOpsProvider – listPullRequests state and merged', () => {
  let provider: AzureDevOpsProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = makeProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps "active" PRs to state "open" and merged false', async () => {
    mockFetch(authResponse, {
      value: [
        {
          pullRequestId: 10,
          title: 'Active PR',
          sourceRefName: 'refs/heads/feature-a',
          targetRefName: 'refs/heads/main',
          status: 'active',
        },
      ],
    });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('open');
    expect(prs[0].merged).toBe(false);
  });

  it('maps "completed" PRs to state "closed" and merged true', async () => {
    mockFetch(authResponse, {
      value: [
        {
          pullRequestId: 11,
          title: 'Completed PR',
          sourceRefName: 'refs/heads/feature-b',
          targetRefName: 'refs/heads/main',
          status: 'completed',
        },
      ],
    });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('closed');
    expect(prs[0].merged).toBe(true);
  });

  it('maps "abandoned" PRs to state "closed" and merged false', async () => {
    mockFetch(authResponse, {
      value: [
        {
          pullRequestId: 12,
          title: 'Abandoned PR',
          sourceRefName: 'refs/heads/feature-c',
          targetRefName: 'refs/heads/main',
          status: 'abandoned',
        },
      ],
    });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('closed');
    expect(prs[0].merged).toBe(false);
  });

  it('correctly maps a mixed list of PRs with different statuses', async () => {
    mockFetch(authResponse, {
      value: [
        {
          pullRequestId: 20,
          title: 'Active',
          sourceRefName: 'refs/heads/branch-a',
          targetRefName: 'refs/heads/main',
          status: 'active',
        },
        {
          pullRequestId: 21,
          title: 'Completed',
          sourceRefName: 'refs/heads/branch-b',
          targetRefName: 'refs/heads/main',
          status: 'completed',
        },
        {
          pullRequestId: 22,
          title: 'Abandoned',
          sourceRefName: 'refs/heads/branch-c',
          targetRefName: 'refs/heads/main',
          status: 'abandoned',
        },
      ],
    });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({ number: 20, state: 'open', merged: false });
    expect(prs[1]).toMatchObject({ number: 21, state: 'closed', merged: true });
    expect(prs[2]).toMatchObject({ number: 22, state: 'closed', merged: false });
  });

  it('returns empty array when API returns no PRs', async () => {
    mockFetch(authResponse, { value: [] });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs).toEqual([]);
  });

  it('returns correct number, url, title, headBranch, baseBranch for each PR', async () => {
    mockFetch(authResponse, {
      value: [
        {
          pullRequestId: 30,
          title: 'My List PR',
          sourceRefName: 'refs/heads/cadre/issue-30',
          targetRefName: 'refs/heads/main',
          status: 'active',
        },
      ],
    });

    await provider.connect();
    const prs = await provider.listPullRequests();

    expect(prs[0].number).toBe(30);
    expect(prs[0].url).toBe(prUrl(30));
    expect(prs[0].title).toBe('My List PR');
    expect(prs[0].headBranch).toBe('cadre/issue-30');
    expect(prs[0].baseBranch).toBe('main');
  });

  it('filters by head branch when filters.head is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    // first call is connect/checkAuth
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => authResponse });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) });

    await provider.connect();
    await provider.listPullRequests({ head: 'cadre/issue-99' });

    const listCall = fetchMock.mock.calls[1][0] as string;
    expect(listCall).toContain('searchCriteria.sourceRefName');
    expect(listCall).toContain('refs%2Fheads%2Fcadre%2Fissue-99');
  });
});
