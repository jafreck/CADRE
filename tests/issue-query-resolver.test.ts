import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueQueryResolver } from '../src/github/query.js';
import { IssueFetcher } from '../src/github/issues.js';
import type { GitHubMCPClient } from '../src/github/mcp-client.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/github/issues.js';

vi.mock('../src/github/issues.js', () => ({
  IssueFetcher: vi.fn().mockImplementation(() => ({
    resolveIssues: vi.fn(),
    fetchIssue: vi.fn(),
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
  return {} as GitHubMCPClient;
}

function makeConfig(overrides: Partial<CadreConfig> = {}): CadreConfig {
  return {
    repository: 'owner/repo',
    issues: { ids: [] },
    ...overrides,
  } as unknown as CadreConfig;
}

function makeIssue(number: number, extra: Partial<IssueDetail> = {}): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    linkedPRs: [],
    ...extra,
  };
}

function getFetcherMock() {
  return vi.mocked(IssueFetcher).mock.results[0]?.value as {
    resolveIssues: ReturnType<typeof vi.fn>;
    fetchIssue: ReturnType<typeof vi.fn>;
  };
}

describe('IssueQueryResolver', () => {
  let resolver: IssueQueryResolver;
  let logger: Logger;
  let config: CadreConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    config = makeConfig();
    resolver = new IssueQueryResolver(config, logger, makeMCP());
  });

  describe('resolve', () => {
    it('returns unique issues from fetcher.resolveIssues', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([makeIssue(1), makeIssue(2)]);

      const result = await resolver.resolve();

      expect(result).toHaveLength(2);
      expect(result.map((i) => i.number)).toEqual([1, 2]);
    });

    it('deduplicates issues with the same number', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([
        makeIssue(5),
        makeIssue(5), // duplicate
        makeIssue(10),
      ]);

      const result = await resolver.resolve();

      expect(result).toHaveLength(2);
      expect(result.map((i) => i.number)).toEqual([5, 10]);
    });

    it('returns empty array when fetcher returns no issues', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([]);

      const result = await resolver.resolve();

      expect(result).toEqual([]);
    });

    it('logs info with resolved count and issue numbers', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([makeIssue(7), makeIssue(8)]);

      await resolver.resolve();

      expect(logger.info).toHaveBeenCalledWith(
        'Resolved 2 unique issues',
        expect.objectContaining({ data: { issueNumbers: [7, 8] } }),
      );
    });

    it('logs count after deduplication, not before', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([
        makeIssue(3),
        makeIssue(3),
        makeIssue(3),
      ]);

      await resolver.resolve();

      expect(logger.info).toHaveBeenCalledWith(
        'Resolved 1 unique issues',
        expect.any(Object),
      );
    });

    it('passes config to the underlying IssueFetcher.resolveIssues', async () => {
      getFetcherMock().resolveIssues.mockResolvedValue([]);

      await resolver.resolve();

      expect(getFetcherMock().resolveIssues).toHaveBeenCalledWith(config);
    });
  });

  describe('resolveOne', () => {
    it('fetches a single issue by number', async () => {
      const issue = makeIssue(42);
      getFetcherMock().fetchIssue.mockResolvedValue(issue);

      const result = await resolver.resolveOne(42);

      expect(result).toEqual(issue);
      expect(getFetcherMock().fetchIssue).toHaveBeenCalledWith(42);
    });

    it('propagates errors from fetchIssue', async () => {
      getFetcherMock().fetchIssue.mockRejectedValue(new Error('not found'));

      await expect(resolver.resolveOne(99)).rejects.toThrow('not found');
    });

    it('returns the exact IssueDetail returned by the fetcher', async () => {
      const issue = makeIssue(1, { title: 'Special Issue', labels: ['critical'] });
      getFetcherMock().fetchIssue.mockResolvedValue(issue);

      const result = await resolver.resolveOne(1);

      expect(result.title).toBe('Special Issue');
      expect(result.labels).toEqual(['critical']);
    });
  });
});
