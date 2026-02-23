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
