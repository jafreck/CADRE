import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAPI } from '../src/github/api.js';
import { GitHubMCPClient } from '../src/github/mcp-client.js';
import { Logger } from '../src/logging/logger.js';

describe('GitHubAPI', () => {
  let api: GitHubAPI;
  let mockLogger: Logger;
  let mockMCP: GitHubMCPClient;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockMCP = {
      callTool: vi.fn(),
      checkAuth: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as GitHubMCPClient;

    api = new GitHubAPI('owner/repo', mockLogger, mockMCP);
  });

  describe('getIssue', () => {
    it('should fetch issue details via MCP', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          number: 42,
          title: 'Fix login',
          body: 'Description',
          labels: [{ name: 'bug' }],
          assignees: [{ login: 'dev1' }],
          state: 'open',
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
        })
        .mockResolvedValueOnce([]);

      const issue = await api.getIssue(42);
      expect(issue).toBeDefined();
      expect(issue.number).toBe(42);
      expect(mockMCP.callTool).toHaveBeenCalledWith('issue_read', {
        method: 'get',
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
    });

    it('should include comments from separate MCP call', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({ number: 42, title: 'Fix login' })
        .mockResolvedValueOnce([
          { body: 'comment 1', user: { login: 'user1' }, created_at: '2024-01-01' },
        ]);

      const issue = await api.getIssue(42);
      expect(issue.comments).toHaveLength(1);
    });
  });

  describe('listIssues', () => {
    it('should fetch issues with filters via MCP', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue([
        { number: 42, title: 'Issue 1', state: 'open' },
        { number: 57, title: 'Issue 2', state: 'open' },
      ]);

      const issues = await api.listIssues({ labels: ['bug'], state: 'open' });
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledWith('list_issues', {
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        labels: ['bug'],
        perPage: 100,
      });
    });

    it('should use search_issues for milestone/assignee filtering', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({
        items: [{ number: 42, title: 'Issue 1' }],
      });

      const issues = await api.listIssues({ milestone: 'v1.0', assignee: 'dev1' });
      expect(issues).toHaveLength(1);
      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        query: expect.stringContaining('milestone:"v1.0"'),
      }));
    });

    // Pagination tests

    it('should make only one MCP call when pageInfo.hasNextPage is false', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        issues: [{ number: 1, title: 'Issue 1' }, { number: 2, title: 'Issue 2' }],
        pageInfo: { hasNextPage: false, endCursor: 'cursor1' },
      });

      const issues = await api.listIssues({});
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });

    it('should fetch multiple pages and concatenate results', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          issues: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-page-1' },
        })
        .mockResolvedValueOnce({
          issues: [{ number: 3 }, { number: 4 }],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-page-2' },
        });

      const issues = await api.listIssues({});
      expect(issues).toHaveLength(4);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(2);
    });

    it('should pass endCursor as after on subsequent pages', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          issues: [{ number: 1 }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-abc' },
        })
        .mockResolvedValueOnce({
          issues: [{ number: 2 }],
          pageInfo: { hasNextPage: false },
        });

      await api.listIssues({});

      expect(mockMCP.callTool).toHaveBeenNthCalledWith(2, 'list_issues', expect.objectContaining({
        after: 'cursor-abc',
      }));
    });

    it('should set perPage to limit when limit is less than 100', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        issues: [{ number: 1 }, { number: 2 }, { number: 3 }],
        pageInfo: { hasNextPage: false },
      });

      await api.listIssues({ limit: 30 });

      expect(mockMCP.callTool).toHaveBeenCalledWith('list_issues', expect.objectContaining({
        perPage: 30,
      }));
    });

    it('should not exceed limit items in returned array', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        issues: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }],
        pageInfo: { hasNextPage: false },
      });

      const issues = await api.listIssues({ limit: 3 });
      expect(issues).toHaveLength(3);
    });

    it('should stop fetching pages when accumulated length reaches limit exactly on a page boundary', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        issues: [{ number: 1 }, { number: 2 }],
        pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
      });

      const issues = await api.listIssues({ limit: 2 });
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });

    it('should reduce perPage on last page when remaining is less than 100', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          issues: Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })),
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        })
        .mockResolvedValueOnce({
          issues: Array.from({ length: 50 }, (_, i) => ({ number: i + 101 })),
          pageInfo: { hasNextPage: false },
        });

      await api.listIssues({ limit: 150 });

      expect(mockMCP.callTool).toHaveBeenNthCalledWith(2, 'list_issues', expect.objectContaining({
        perPage: 50,
      }));
    });

    it('should fetch all pages when no limit is specified', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          issues: [{ number: 1 }],
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
        })
        .mockResolvedValueOnce({
          issues: [{ number: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'c2' },
        })
        .mockResolvedValueOnce({
          issues: [{ number: 3 }],
          pageInfo: { hasNextPage: false },
        });

      const issues = await api.listIssues({});
      expect(issues).toHaveLength(3);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(3);
    });

    it('should handle array response format (no envelope) without paginating', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce([
        { number: 1 },
        { number: 2 },
      ]);

      const issues = await api.listIssues({});
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchIssuesWithFilters (via listIssues with milestone/assignee)', () => {
    it('should make first call without an after parameter', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [{ number: 1, title: 'Issue 1' }],
        pageInfo: { hasNextPage: false },
      });

      await api.listIssues({ milestone: 'v1.0' });

      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.not.objectContaining({
        after: expect.anything(),
      }));
    });

    it('should pass endCursor as after on subsequent calls', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          items: [{ number: 1 }],
          pageInfo: { hasNextPage: true, endCursor: 'search-cursor-abc' },
        })
        .mockResolvedValueOnce({
          items: [{ number: 2 }],
          pageInfo: { hasNextPage: false },
        });

      await api.listIssues({ assignee: 'dev1' });

      expect(mockMCP.callTool).toHaveBeenNthCalledWith(2, 'search_issues', expect.objectContaining({
        after: 'search-cursor-abc',
      }));
    });

    it('should terminate when pageInfo.hasNextPage is false', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-x' },
        });

      const issues = await api.listIssues({ milestone: 'v2.0' });
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });

    it('should accumulate results across multiple pages', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
        })
        .mockResolvedValueOnce({
          items: [{ number: 3 }, { number: 4 }],
          pageInfo: { hasNextPage: true, endCursor: 'c2' },
        })
        .mockResolvedValueOnce({
          items: [{ number: 5 }],
          pageInfo: { hasNextPage: false },
        });

      const issues = await api.listIssues({ assignee: 'dev1' });
      expect(issues).toHaveLength(5);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(3);
    });

    it('should terminate when pageInfo is absent in response (legacy fallback)', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [{ number: 1 }, { number: 2 }],
        // no pageInfo
      });

      const issues = await api.listIssues({ milestone: 'v1.0' });
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });

    it('should not make an extra call when accumulated length reaches limit at page boundary', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [{ number: 1 }, { number: 2 }],
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
      });

      const issues = await api.listIssues({ assignee: 'dev1', limit: 2 });
      expect(issues).toHaveLength(2);
      expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
    });

    it('should truncate results to filters.limit', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }],
        pageInfo: { hasNextPage: false },
      });

      const issues = await api.listIssues({ milestone: 'v1.0', limit: 3 });
      expect(issues).toHaveLength(3);
    });

    it('should build search query with all filter types', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [],
        pageInfo: { hasNextPage: false },
      });

      await api.listIssues({
        milestone: 'v2.0',
        assignee: 'octocat',
        labels: ['bug', 'urgent'],
        state: 'open',
      });

      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        query: expect.stringContaining('milestone:"v2.0"'),
      }));
      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        query: expect.stringContaining('assignee:octocat'),
      }));
      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        query: expect.stringContaining('label:"bug"'),
      }));
      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        query: expect.stringContaining('is:open'),
      }));
    });

    it('should set perPage to remaining count when limit is less than 100', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
        items: [{ number: 1 }, { number: 2 }],
        pageInfo: { hasNextPage: false },
      });

      await api.listIssues({ milestone: 'v1.0', limit: 25 });

      expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
        perPage: 25,
      }));
    });
  });

  describe('checkAuth', () => {
    it('should return true when MCP server is authenticated', async () => {
      vi.mocked(mockMCP.checkAuth).mockResolvedValue(true);

      const result = await api.checkAuth();
      expect(result).toBe(true);
    });

    it('should return false when MCP server is not authenticated', async () => {
      vi.mocked(mockMCP.checkAuth).mockResolvedValue(false);

      const result = await api.checkAuth();
      expect(result).toBe(false);
    });
  });

  describe('getPRReviewComments', () => {
    it('should call pull_request_read with get_review_comments method', async () => {
      const mockComments = [{ id: 1, body: 'Looks good' }];
      vi.mocked(mockMCP.callTool).mockResolvedValue(mockComments);

      const result = await api.getPRReviewComments(42);

      expect(mockMCP.callTool).toHaveBeenCalledWith('pull_request_read', {
        method: 'get_review_comments',
        owner: 'owner',
        repo: 'repo',
        pullNumber: 42,
      });
      expect(result).toBe(mockComments);
    });
  });

  describe('ensureLabel', () => {
    it('should call create_label with default color when no color provided', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({});

      await api.ensureLabel('cadre-generated');

      expect(mockMCP.callTool).toHaveBeenCalledWith('create_label', {
        owner: 'owner',
        repo: 'repo',
        name: 'cadre-generated',
        color: 'ededed',
      });
    });

    it('should call create_label with provided color', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({});

      await api.ensureLabel('bug', 'ff0000');

      expect(mockMCP.callTool).toHaveBeenCalledWith('create_label', {
        owner: 'owner',
        repo: 'repo',
        name: 'bug',
        color: 'ff0000',
      });
    });

    it('should silently ignore 422 already-exists errors', async () => {
      vi.mocked(mockMCP.callTool).mockRejectedValue(new Error('422 Unprocessable Entity'));

      await expect(api.ensureLabel('bug')).resolves.toBeUndefined();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should silently ignore errors containing "already exists"', async () => {
      vi.mocked(mockMCP.callTool).mockRejectedValue(new Error('Label already exists'));

      await expect(api.ensureLabel('bug')).resolves.toBeUndefined();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should warn for non-422 errors', async () => {
      vi.mocked(mockMCP.callTool).mockRejectedValue(new Error('Network error'));

      await api.ensureLabel('bug');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create label "bug"'),
      );
    });
  });

  describe('applyLabels', () => {
    it('should call issue_write with the given labels when PR has no existing labels', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({});

      await api.applyLabels(42, ['bug', 'enhancement']);

      expect(mockMCP.callTool).toHaveBeenCalledWith('issue_write', {
        method: 'update',
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['bug', 'enhancement'],
      });
    });

    it('should merge new labels with existing PR labels without clobbering', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({ labels: [{ name: 'existing-label' }, { name: 'other' }] }) // issue_read
        .mockResolvedValueOnce({}); // issue_write

      await api.applyLabels(42, ['cadre-generated']);

      expect(mockMCP.callTool).toHaveBeenLastCalledWith('issue_write', {
        method: 'update',
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: expect.arrayContaining(['existing-label', 'other', 'cadre-generated']),
      });
    });

    it('should deduplicate labels when the label is already present', async () => {
      vi.mocked(mockMCP.callTool)
        .mockResolvedValueOnce({ labels: [{ name: 'cadre-generated' }] }) // issue_read
        .mockResolvedValueOnce({}); // issue_write

      await api.applyLabels(42, ['cadre-generated']);

      const issueWriteCall = vi.mocked(mockMCP.callTool).mock.calls.find(
        (c) => c[0] === 'issue_write',
      )!;
      const appliedLabels = (issueWriteCall[1] as Record<string, unknown>).labels as string[];
      expect(appliedLabels.filter((l) => l === 'cadre-generated')).toHaveLength(1);
    });

    it('should not call issue_write when labels array is empty', async () => {
      await api.applyLabels(42, []);

      expect(mockMCP.callTool).not.toHaveBeenCalled();
    });

    it('should warn when issue_write fails', async () => {
      vi.mocked(mockMCP.callTool).mockRejectedValue(new Error('Forbidden'));

      await api.applyLabels(42, ['bug']);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to apply labels to PR #42'),
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create a PR via MCP', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({
        number: 87,
        html_url: 'https://github.com/owner/repo/pull/87',
        title: 'Fix login (#42)',
      });

      const pr = await api.createPullRequest({
        title: 'Fix login (#42)',
        body: 'Closes #42',
        head: 'cadre/issue-42',
        base: 'main',
        draft: true,
      });

      expect(pr.number).toBe(87);
      expect(mockMCP.callTool).toHaveBeenCalledWith('create_pull_request', {
        owner: 'owner',
        repo: 'repo',
        title: 'Fix login (#42)',
        body: 'Closes #42',
        head: 'cadre/issue-42',
        base: 'main',
        draft: true,
      });
    });

    it('should apply labels via a separate issue_write call after PR creation', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 88 });

      await api.createPullRequest({
        title: 'Add feature',
        body: 'Adds a feature',
        head: 'feature-branch',
        base: 'main',
        labels: ['enhancement', 'cadre-generated'],
      });

      // Labels are NOT passed to create_pull_request (MCP tool schema does not support it)
      expect(mockMCP.callTool).toHaveBeenCalledWith('create_pull_request', expect.not.objectContaining({
        labels: expect.anything(),
      }));
      // Labels are applied via a separate issue_write call using the new PR number
      expect(mockMCP.callTool).toHaveBeenCalledWith('issue_write', expect.objectContaining({
        method: 'update',
        issue_number: 88,
        labels: ['enhancement', 'cadre-generated'],
      }));
    });

    it('should request reviewers via a separate update_pull_request call after PR creation', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 89 });

      await api.createPullRequest({
        title: 'Add feature',
        body: 'Adds a feature',
        head: 'feature-branch',
        base: 'main',
        reviewers: ['alice', 'bob'],
      });

      // Reviewers are NOT passed to create_pull_request (MCP tool schema does not support it)
      expect(mockMCP.callTool).toHaveBeenCalledWith('create_pull_request', expect.not.objectContaining({
        reviewers: expect.anything(),
      }));
      // Reviewers are requested via a separate update_pull_request call
      expect(mockMCP.callTool).toHaveBeenCalledWith('update_pull_request', expect.objectContaining({
        pullNumber: 89,
        reviewers: ['alice', 'bob'],
      }));
    });

    it('should apply labels and request reviewers via separate calls after PR creation', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 90 });

      await api.createPullRequest({
        title: 'Refactor module',
        body: 'Refactors the module',
        head: 'refactor-branch',
        base: 'main',
        labels: ['refactor'],
        reviewers: ['charlie'],
      });

      expect(mockMCP.callTool).toHaveBeenCalledWith('issue_write', expect.objectContaining({
        method: 'update',
        issue_number: 90,
        labels: ['refactor'],
      }));
      expect(mockMCP.callTool).toHaveBeenCalledWith('update_pull_request', expect.objectContaining({
        pullNumber: 90,
        reviewers: ['charlie'],
      }));
    });

    it('should omit labels from MCP call when labels array is empty', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 91 });

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
        labels: [],
      });

      const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('labels');
    });

    it('should omit reviewers from MCP call when reviewers array is empty', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 92 });

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
        reviewers: [],
      });

      const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('reviewers');
    });

    it('should omit labels and reviewers from MCP call when neither is provided', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({ number: 93 });

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
      });

      const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('labels');
      expect(callArgs).not.toHaveProperty('reviewers');
    });
  });
});
