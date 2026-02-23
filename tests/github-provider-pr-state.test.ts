import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { GitHubMCPClient } from '../src/github/mcp-client.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

function makeMockMCP() {
  return {
    callTool: vi.fn(),
    checkAuth: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as GitHubMCPClient;
}

async function makeConnectedProvider() {
  const mockMCP = makeMockMCP();
  const provider = new GitHubProvider(
    'owner/repo',
    { command: 'github-mcp-server', args: ['stdio'] },
    mockLogger,
  );
  (provider as any).mcpClient = mockMCP;
  await provider.connect();
  return { provider, mockMCP };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GitHubProvider – getPullRequest state and merged', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ provider, mockMCP } = await makeConnectedProvider());
  });

  it('returns state "merged" and merged true when merged_at is non-null', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 1,
      title: 'Merged PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'closed',
      merged_at: '2024-06-01T12:00:00Z',
    });

    const pr = await provider.getPullRequest(1);

    expect(pr.state).toBe('merged');
    expect(pr.merged).toBe(true);
  });

  it('returns state "merged" and merged true when merged is true', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 2,
      title: 'Merged PR via flag',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'closed',
      merged: true,
    });

    const pr = await provider.getPullRequest(2);

    expect(pr.state).toBe('merged');
    expect(pr.merged).toBe(true);
  });

  it('returns state "closed" and merged false for a closed-without-merge PR', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 3,
      title: 'Closed PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'closed',
    });

    const pr = await provider.getPullRequest(3);

    expect(pr.state).toBe('closed');
    expect(pr.merged).toBe(false);
  });

  it('returns state "open" and merged false for an open PR', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 4,
      title: 'Open PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'open',
    });

    const pr = await provider.getPullRequest(4);

    expect(pr.state).toBe('open');
    expect(pr.merged).toBe(false);
  });

  it('returns state "open" and merged false when state is absent', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 5,
      title: 'PR without state',
      head: { ref: 'feature' },
      base: { ref: 'main' },
    });

    const pr = await provider.getPullRequest(5);

    expect(pr.state).toBe('open');
    expect(pr.merged).toBe(false);
  });

  it('returns correct number, url, title, headBranch, baseBranch', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 42,
      html_url: 'https://github.com/owner/repo/pull/42',
      title: 'My PR',
      head: { ref: 'cadre/issue-42' },
      base: { ref: 'main' },
      state: 'open',
    });

    const pr = await provider.getPullRequest(42);

    expect(pr.number).toBe(42);
    expect(pr.url).toBe('https://github.com/owner/repo/pull/42');
    expect(pr.title).toBe('My PR');
    expect(pr.headBranch).toBe('cadre/issue-42');
    expect(pr.baseBranch).toBe('main');
  });
});

describe('GitHubProvider – listPullRequests state and merged', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ provider, mockMCP } = await makeConnectedProvider());
  });

  it('maps open PRs to state "open" and merged false', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 10,
        html_url: 'https://github.com/owner/repo/pull/10',
        title: 'Open PR',
        head: { ref: 'feature-a' },
        base: { ref: 'main' },
        state: 'open',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('open');
    expect(prs[0].merged).toBe(false);
  });

  it('maps PRs with merged_at to state "merged" and merged true', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 11,
        html_url: 'https://github.com/owner/repo/pull/11',
        title: 'Merged PR',
        head: { ref: 'feature-b' },
        base: { ref: 'main' },
        state: 'closed',
        merged_at: '2024-06-15T10:00:00Z',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('merged');
    expect(prs[0].merged).toBe(true);
  });

  it('maps closed-without-merge PRs to state "closed" and merged false', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 12,
        html_url: 'https://github.com/owner/repo/pull/12',
        title: 'Abandoned PR',
        head: { ref: 'feature-c' },
        base: { ref: 'main' },
        state: 'closed',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('closed');
    expect(prs[0].merged).toBe(false);
  });

  it('correctly maps a mixed list of PRs with different states', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 20,
        html_url: 'https://github.com/owner/repo/pull/20',
        title: 'Open',
        head: { ref: 'branch-a' },
        base: { ref: 'main' },
        state: 'open',
      },
      {
        number: 21,
        html_url: 'https://github.com/owner/repo/pull/21',
        title: 'Merged',
        head: { ref: 'branch-b' },
        base: { ref: 'main' },
        state: 'closed',
        merged_at: '2024-07-01T00:00:00Z',
      },
      {
        number: 22,
        html_url: 'https://github.com/owner/repo/pull/22',
        title: 'Closed',
        head: { ref: 'branch-c' },
        base: { ref: 'main' },
        state: 'closed',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({ number: 20, state: 'open', merged: false });
    expect(prs[1]).toMatchObject({ number: 21, state: 'merged', merged: true });
    expect(prs[2]).toMatchObject({ number: 22, state: 'closed', merged: false });
  });

  it('returns empty array when API returns no PRs', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([]);

    const prs = await provider.listPullRequests();

    expect(prs).toEqual([]);
  });

  it('returns correct number, url, title, headBranch, baseBranch for each PR', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 30,
        html_url: 'https://github.com/owner/repo/pull/30',
        title: 'My List PR',
        head: { ref: 'cadre/issue-30' },
        base: { ref: 'main' },
        state: 'open',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].number).toBe(30);
    expect(prs[0].url).toBe('https://github.com/owner/repo/pull/30');
    expect(prs[0].title).toBe('My List PR');
    expect(prs[0].headBranch).toBe('cadre/issue-30');
    expect(prs[0].baseBranch).toBe('main');
  });
});
