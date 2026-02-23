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

describe('GitHubProvider – parseIssue type guards', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMCP = makeMockMCP();
    provider = new GitHubProvider('owner/repo', { command: 'github-mcp-server', args: ['stdio'] }, mockLogger);
    // Inject our mock MCP by replacing the private field after connect()
    (provider as any).mcpClient = mockMCP;
    // Manually trigger connect logic: set api using real GitHubAPI wired to mock MCP
    await provider.connect();
  });

  it('should parse a fully-populated issue', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({
        number: 42,
        title: 'Fix bug',
        body: 'Description here',
        state: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        labels: [{ name: 'bug' }, { name: 'priority' }],
        assignees: [{ login: 'alice' }],
        milestone: { title: 'v1.0' },
      })
      .mockResolvedValueOnce([
        { author: { login: 'bob' }, body: 'Comment text', createdAt: '2024-01-03T00:00:00Z' },
      ]);

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
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ title: 'No number' })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(0);

    expect(issue.number).toBe(0);
  });

  it('should fall back to empty string when string fields are absent', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 1 })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(1);

    expect(issue.title).toBe('');
    expect(issue.body).toBe('');
    expect(issue.createdAt).toBe('');
    expect(issue.updatedAt).toBe('');
  });

  it('should fall back to empty string when string fields have wrong type', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 5, title: 99, body: true })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(5);

    expect(issue.title).toBe('');
    expect(issue.body).toBe('');
  });

  it('should default to "open" when state is not "closed"', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 3, state: 'unknown' })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(3);

    expect(issue.state).toBe('open');
  });

  it('should parse state "closed" correctly', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 7, state: 'closed' })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(7);

    expect(issue.state).toBe('closed');
  });

  it('should produce empty arrays when labels/assignees are absent', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 10 })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(10);

    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.comments).toEqual([]);
  });

  it('should omit milestone when raw.milestone is falsy', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 11 })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(11);

    expect(issue.milestone).toBeUndefined();
  });

  it('should use "unknown" as comment author fallback when author is absent', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 12 })
      .mockResolvedValueOnce([{ body: 'hello', createdAt: '' }]);

    const issue = await provider.getIssue(12);

    expect(issue.comments[0].author).toBe('unknown');
  });

  it('should handle label objects with non-string name gracefully', async () => {
    vi.mocked(mockMCP.callTool)
      .mockResolvedValueOnce({ number: 13, labels: [{ name: 123 }, { name: 'valid' }] })
      .mockResolvedValueOnce([]);

    const issue = await provider.getIssue(13);

    expect(issue.labels).toEqual(['', 'valid']);
  });
});

describe('GitHubProvider – createPullRequest type guards', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMCP = makeMockMCP();
    provider = new GitHubProvider('owner/repo', { command: 'github-mcp-server', args: ['stdio'] }, mockLogger);
    (provider as any).mcpClient = mockMCP;
    await provider.connect();
  });

  it('should parse a full createPullRequest response', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
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

  it('should always set merged to false for a newly created PR', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 60,
      html_url: 'https://github.com/owner/repo/pull/60',
      title: 'New PR',
    });

    const pr = await provider.createPullRequest({
      title: 'New PR',
      body: '',
      head: 'feature',
      base: 'main',
    });

    expect(pr.merged).toBe(false);
  });

  it('should fall back to params.title when response title is absent', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
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
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
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
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
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
});

describe('GitHubProvider – getPullRequest type guards', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMCP = makeMockMCP();
    provider = new GitHubProvider('owner/repo', { command: 'github-mcp-server', args: ['stdio'] }, mockLogger);
    (provider as any).mcpClient = mockMCP;
    await provider.connect();
  });

  it('should parse a full getPullRequest response', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
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

  it('should set merged to true when API response has merged: true', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 91,
      title: 'Merged PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      merged: true,
    });

    const pr = await provider.getPullRequest(91);

    expect(pr.merged).toBe(true);
  });

  it('should set merged to true when API response has merged_at set', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 92,
      title: 'Merged via merged_at',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      merged_at: '2024-06-01T12:00:00Z',
    });

    const pr = await provider.getPullRequest(92);

    expect(pr.merged).toBe(true);
  });

  it('should set merged to false when neither merged nor merged_at are present', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 93,
      title: 'Open PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
    });

    const pr = await provider.getPullRequest(93);

    expect(pr.merged).toBe(false);
  });

  it('should default branch refs to empty string when head/base are absent', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 89,
      title: 'PR no refs',
    });

    const pr = await provider.getPullRequest(89);

    expect(pr.headBranch).toBe('');
    expect(pr.baseBranch).toBe('');
  });

  it('should default branch refs to empty string when head/base are not objects', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 90,
      head: 'not-an-object',
      base: 42,
    });

    const pr = await provider.getPullRequest(90);

    expect(pr.headBranch).toBe('');
    expect(pr.baseBranch).toBe('');
  });

  it('should set state to "open" when API response has state: "open"', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 100,
      title: 'Open PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'open',
    });

    const pr = await provider.getPullRequest(100);

    expect(pr.state).toBe('open');
  });

  it('should set state to "closed" when API response has state: "closed"', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 101,
      title: 'Closed PR',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'closed',
    });

    const pr = await provider.getPullRequest(101);

    expect(pr.state).toBe('closed');
  });

  it('should default state to "open" when state is absent from API response', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 102,
      title: 'PR without state',
      head: { ref: 'feature' },
      base: { ref: 'main' },
    });

    const pr = await provider.getPullRequest(102);

    expect(pr.state).toBe('open');
  });

  it('should default state to "open" when state has an unexpected value', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
      number: 103,
      title: 'PR with weird state',
      head: { ref: 'feature' },
      base: { ref: 'main' },
      state: 'merged',
    });

    const pr = await provider.getPullRequest(103);

    expect(pr.state).toBe('merged');
  });
});

describe('GitHubProvider – listPullRequests type guards', () => {
  let provider: GitHubProvider;
  let mockMCP: GitHubMCPClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMCP = makeMockMCP();
    provider = new GitHubProvider('owner/repo', { command: 'github-mcp-server', args: ['stdio'] }, mockLogger);
    (provider as any).mcpClient = mockMCP;
    await provider.connect();
  });

  it('should parse a list of pull requests', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
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

  it('should set merged to true for a PR with merged: true in list results', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 20,
        html_url: 'https://github.com/owner/repo/pull/20',
        title: 'Merged PR',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        merged: true,
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(true);
  });

  it('should set merged to true for a PR with merged_at in list results', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 21,
        html_url: 'https://github.com/owner/repo/pull/21',
        title: 'Merged via merged_at',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        merged_at: '2024-07-01T00:00:00Z',
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(true);
  });

  it('should set merged to false for a PR with no merge indicators in list results', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      {
        number: 22,
        html_url: 'https://github.com/owner/repo/pull/22',
        title: 'Open PR',
        head: { ref: 'feature' },
        base: { ref: 'main' },
      },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(false);
  });

  it('should produce empty list when API returns empty array', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([]);

    const prs = await provider.listPullRequests();

    expect(prs).toEqual([]);
  });

  it('should default missing fields to empty string and 0 for each PR', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([{ url: 'https://api.github.com/repos/owner/repo/pulls/0' }]);

    const prs = await provider.listPullRequests();

    expect(prs[0].number).toBe(0);
    expect(prs[0].title).toBe('');
    expect(prs[0].url).toBe('https://api.github.com/repos/owner/repo/pulls/0');
    expect(prs[0].headBranch).toBe('');
    expect(prs[0].baseBranch).toBe('');
  });

  it('should populate state for each PR from the API response', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      { number: 20, title: 'Open PR', head: { ref: 'a' }, base: { ref: 'main' }, state: 'open' },
      { number: 21, title: 'Closed PR', head: { ref: 'b' }, base: { ref: 'main' }, state: 'closed' },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].state).toBe('open');
    expect(prs[1].state).toBe('closed');
  });

  it('should default state to "open" when state is absent for a PR in the list', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      { number: 22, title: 'PR no state', head: { ref: 'c' }, base: { ref: 'main' } },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].state).toBe('open');
  });

  it('should set merged to true when PR in list has merged: true', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      { number: 30, title: 'Merged PR', head: { ref: 'feature' }, base: { ref: 'main' }, state: 'closed', merged: true },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(true);
  });

  it('should set merged to true when PR in list has merged_at set', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      { number: 31, title: 'Merged via merged_at', head: { ref: 'feature' }, base: { ref: 'main' }, merged_at: '2024-06-01T12:00:00Z' },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(true);
  });

  it('should set merged to false when neither merged nor merged_at are present for a PR in the list', async () => {
    vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
      { number: 32, title: 'Open PR', head: { ref: 'feature' }, base: { ref: 'main' }, state: 'open' },
    ]);

    const prs = await provider.listPullRequests();

    expect(prs[0].merged).toBe(false);
  });
});
