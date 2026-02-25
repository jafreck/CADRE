import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PullRequestCreator } from '../src/git/pr.js';
import { GitHubAPI } from '../src/github/api.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { Octokit } from '@octokit/rest';

describe('PullRequestCreator', () => {
  let creator: PullRequestCreator;
  let mockLogger: Logger;
  let mockConfig: CadreConfig;
  let mockOctokit: {
    rest: {
      pulls: {
        list: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        requestReviewers: ReturnType<typeof vi.fn>;
        listReviewComments: ReturnType<typeof vi.fn>;
        listReviews: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
      };
      issues: {
        get: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        listComments: ReturnType<typeof vi.fn>;
        createComment: ReturnType<typeof vi.fn>;
        createLabel: ReturnType<typeof vi.fn>;
        addLabels: ReturnType<typeof vi.fn>;
      };
      users: {
        getAuthenticated: ReturnType<typeof vi.fn>;
      };
      search: {
        issuesAndPullRequests: ReturnType<typeof vi.fn>;
      };
    };
    paginate: ReturnType<typeof vi.fn>;
  };
  let api: GitHubAPI;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockConfig = {
      projectName: 'test-project',
      repository: 'owner/repo',
      baseBranch: 'main',
      pullRequest: {
        autoCreate: true,
        draft: true,
        labels: ['cadre-generated'],
        reviewers: [],
        linkIssue: true,
      },
    } as CadreConfig;

    mockOctokit = {
      rest: {
        pulls: {
          list: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          requestReviewers: vi.fn(),
          listReviewComments: vi.fn(),
          listReviews: vi.fn(),
          get: vi.fn(),
        },
        issues: {
          get: vi.fn(),
          update: vi.fn(),
          listComments: vi.fn(),
          createComment: vi.fn(),
          createLabel: vi.fn(),
          addLabels: vi.fn(),
        },
        users: {
          getAuthenticated: vi.fn(),
        },
        search: {
          issuesAndPullRequests: vi.fn(),
        },
      },
      paginate: vi.fn(),
    };

    api = new GitHubAPI('owner/repo', mockLogger, mockOctokit as unknown as Octokit);
    creator = new PullRequestCreator(mockConfig, mockLogger, api);
  });

  describe('exists', () => {
    it('should detect existing PR', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          {
            number: 87,
            html_url: 'https://github.com/owner/repo/pull/87',
            title: 'Fix login',
            head: { ref: 'cadre/issue-42' },
            base: { ref: 'main' },
          },
        ],
      });

      const result = await creator.exists('cadre/issue-42');
      expect(result).toBeDefined();
      expect(result!.number).toBe(87);
    });

    it('should return null when no PR exists', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });

      const result = await creator.exists('cadre/issue-42');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a PR with the correct title and return PullRequestInfo', async () => {
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: {
          number: 99,
          html_url: 'https://github.com/owner/repo/pull/99',
          title: 'Fix login (#42)',
        },
      });
      mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: {} });

      const result = await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      expect(result.number).toBe(99);
      expect(result.url).toBe('https://github.com/owner/repo/pull/99');
      expect(result.title).toBe('Fix login (#42)');
      expect(result.headBranch).toBe('cadre/issue-42');
      expect(result.baseBranch).toBe('main');
    });

    it('should append "Closes #N" to body when linkIssue is true', async () => {
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 99, html_url: 'https://github.com/owner/repo/pull/99' },
      });
      mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: {} });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      const callArgs = mockOctokit.rest.pulls.create.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.body as string).toContain('Closes #42');
    });

    it('should not append "Closes #N" when linkIssue is false', async () => {
      mockConfig.pullRequest.linkIssue = false;
      creator = new PullRequestCreator(mockConfig, mockLogger, api);

      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 99, html_url: 'https://github.com/owner/repo/pull/99' },
      });
      mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: {} });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      const callArgs = mockOctokit.rest.pulls.create.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.body as string).not.toContain('Closes #42');
    });

    it('should log info with PR number and URL after creation', async () => {
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 99, html_url: 'https://github.com/owner/repo/pull/99' },
      });
      mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: {} });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body', '/tmp/wt');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created PR #99'),
        expect.any(Object),
      );
    });
  });

  describe('update', () => {
    it('should call api.updatePullRequest with prNumber and updates', async () => {
      mockOctokit.rest.pulls.update.mockResolvedValue({ data: {} });

      await creator.update(99, { title: 'New Title', body: 'New body' });

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalled();
    });

    it('should log warn and not throw when update fails', async () => {
      mockOctokit.rest.pulls.update.mockRejectedValueOnce(new Error('API error'));

      await expect(creator.update(99, { title: 'New Title' })).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update PR #99'),
      );
    });
  });

  it('should have create method', () => {
    expect(typeof creator.create).toBe('function');
  });

  it('should have update method', () => {
    expect(typeof creator.update).toBe('function');
  });
});
