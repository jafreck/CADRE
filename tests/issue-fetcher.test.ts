import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueFetcher } from '../src/github/issues.js';
import { GitHubAPI } from '../src/github/api.js';
import type { GitHubMCPClient } from '../src/github/mcp-client.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';

vi.mock('../src/github/api.js', () => ({
  GitHubAPI: vi.fn().mockImplementation(() => ({
    getIssue: vi.fn(),
    listIssues: vi.fn(),
  })),
}));

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeMCP(): GitHubMCPClient {
  return {
    callTool: vi.fn(),
    checkAuth: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as GitHubMCPClient;
}

function getApiMock() {
  return vi.mocked(GitHubAPI).mock.results[0]?.value as {
    getIssue: ReturnType<typeof vi.fn>;
    listIssues: ReturnType<typeof vi.fn>;
  };
}

function makeRawIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 1,
    title: 'Test issue',
    body: 'Issue body',
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    labels: [],
    assignees: [],
    comments: [],
    milestone: null,
    ...overrides,
  };
}

describe('IssueFetcher', () => {
  let fetcher: IssueFetcher;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    fetcher = new IssueFetcher('owner/repo', logger, makeMCP());
  });

  describe('fetchIssue', () => {
    it('logs debug before fetching', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ number: 42 }));

      await fetcher.fetchIssue(42);

      expect(logger.debug).toHaveBeenCalledWith('Fetching issue #42', { issueNumber: 42 });
    });

    it('returns parsed IssueDetail with correct number and title', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ number: 42, title: 'My Issue' }));

      const result = await fetcher.fetchIssue(42);

      expect(result.number).toBe(42);
      expect(result.title).toBe('My Issue');
    });

    it('parses labels array correctly', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({ labels: [{ name: 'bug' }, { name: 'enhancement' }] }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.labels).toEqual(['bug', 'enhancement']);
    });

    it('parses assignees array correctly', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({ assignees: [{ login: 'alice' }, { login: 'bob' }] }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.assignees).toEqual(['alice', 'bob']);
    });

    it('parses milestone title when present', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({ milestone: { title: 'v2.0' } }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.milestone).toBe('v2.0');
    });

    it('leaves milestone undefined when null', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ milestone: null }));

      const result = await fetcher.fetchIssue(1);

      expect(result.milestone).toBeUndefined();
    });

    it('parses comments with author, body, and createdAt', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({
          comments: [
            { author: { login: 'reviewer' }, body: 'LGTM', createdAt: '2024-06-01T00:00:00Z' },
          ],
        }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]).toEqual({
        author: 'reviewer',
        body: 'LGTM',
        createdAt: '2024-06-01T00:00:00Z',
      });
    });

    it('defaults comment author to "unknown" when missing', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({ comments: [{ body: 'hello', createdAt: '' }] }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.comments[0].author).toBe('unknown');
    });

    it('returns empty labels and assignees when absent from raw', async () => {
      getApiMock().getIssue.mockResolvedValue(
        makeRawIssue({ labels: undefined, assignees: undefined }),
      );

      const result = await fetcher.fetchIssue(1);

      expect(result.labels).toEqual([]);
      expect(result.assignees).toEqual([]);
    });

    it('always returns linkedPRs as empty array', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue());

      const result = await fetcher.fetchIssue(1);

      expect(result.linkedPRs).toEqual([]);
    });

    it('propagates errors from api.getIssue', async () => {
      getApiMock().getIssue.mockRejectedValue(new Error('API timeout'));

      await expect(fetcher.fetchIssue(99)).rejects.toThrow('API timeout');
    });
  });

  describe('queryIssues', () => {
    it('calls api.listIssues with the provided query', async () => {
      getApiMock().listIssues.mockResolvedValue([]);

      await fetcher.queryIssues({ labels: ['bug'], state: 'open' });

      expect(getApiMock().listIssues).toHaveBeenCalledWith({
        labels: ['bug'],
        state: 'open',
      });
    });

    it('returns an empty array when no issues match', async () => {
      getApiMock().listIssues.mockResolvedValue([]);

      const result = await fetcher.queryIssues({});

      expect(result).toEqual([]);
    });

    it('fetches full details for each issue returned by listIssues', async () => {
      getApiMock().listIssues.mockResolvedValue([{ number: 10 }, { number: 20 }]);
      getApiMock().getIssue
        .mockResolvedValueOnce(makeRawIssue({ number: 10, title: 'Issue 10' }))
        .mockResolvedValueOnce(makeRawIssue({ number: 20, title: 'Issue 20' }));

      const result = await fetcher.queryIssues({});

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(10);
      expect(result[1].number).toBe(20);
    });

    it('skips and warns when fetchIssue fails for one issue', async () => {
      getApiMock().listIssues.mockResolvedValue([{ number: 10 }, { number: 20 }]);
      getApiMock().getIssue
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(makeRawIssue({ number: 20, title: 'Issue 20' }));

      const result = await fetcher.queryIssues({});

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(20);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('#10'),
        expect.any(Object),
      );
    });

    it('logs debug with the query before fetching', async () => {
      getApiMock().listIssues.mockResolvedValue([]);

      await fetcher.queryIssues({ labels: ['enhancement'] });

      expect(logger.debug).toHaveBeenCalledWith('Querying issues', expect.any(Object));
    });
  });

  describe('resolveIssues', () => {
    it('fetches explicit issue IDs from config.issues.ids', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ number: 5, title: 'Issue 5' }));

      const config = {
        issues: { ids: [5] },
      } as unknown as CadreConfig;

      const result = await fetcher.resolveIssues(config);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(5);
    });

    it('logs info about how many explicit issues are being resolved', async () => {
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ number: 1 }));

      const config = { issues: { ids: [1, 2] } } as unknown as CadreConfig;
      // second call also needs a return value
      getApiMock().getIssue.mockResolvedValue(makeRawIssue({ number: 2 }));

      await fetcher.resolveIssues(config);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('2 explicit issues'));
    });

    it('logs error and skips issue when explicit ID fetch fails', async () => {
      getApiMock().getIssue.mockRejectedValue(new Error('forbidden'));

      const config = { issues: { ids: [99] } } as unknown as CadreConfig;

      const result = await fetcher.resolveIssues(config);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('#99'),
        expect.any(Object),
      );
    });

    it('queries issues when config uses query form', async () => {
      getApiMock().listIssues.mockResolvedValue([]);

      const config = {
        issues: {
          query: { labels: ['bug'], milestone: 'v1.0', assignee: 'alice', state: 'open', limit: 10 },
        },
      } as unknown as CadreConfig;

      const result = await fetcher.resolveIssues(config);

      expect(result).toEqual([]);
      expect(getApiMock().listIssues).toHaveBeenCalledWith({
        labels: ['bug'],
        milestone: 'v1.0',
        assignee: 'alice',
        state: 'open',
        limit: 10,
      });
    });

    it('returns empty array when config has neither ids nor query', async () => {
      const config = { issues: {} } as unknown as CadreConfig;

      const result = await fetcher.resolveIssues(config);

      expect(result).toEqual([]);
    });
  });
});
