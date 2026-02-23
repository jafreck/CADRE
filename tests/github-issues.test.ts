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

    describe('searchIssuesWithFilters cursor-based pagination', () => {
      it('should make the first call without an after parameter', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ milestone: 'v1.0' });

        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.not.objectContaining({
          after: expect.anything(),
        }));
      });

      it('should pass endCursor as after on the second page', async () => {
        vi.mocked(mockMCP.callTool)
          .mockResolvedValueOnce({
            items: [{ number: 1 }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-xyz' },
          })
          .mockResolvedValueOnce({
            items: [{ number: 2 }],
            pageInfo: { hasNextPage: false },
          });

        await api.listIssues({ milestone: 'v1.0' });

        expect(mockMCP.callTool).toHaveBeenNthCalledWith(2, 'search_issues', expect.objectContaining({
          after: 'cursor-xyz',
        }));
      });

      it('should stop paginating when pageInfo.hasNextPage is false', async () => {
        vi.mocked(mockMCP.callTool)
          .mockResolvedValueOnce({
            items: [{ number: 1 }, { number: 2 }],
            pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
          });

        const issues = await api.listIssues({ assignee: 'dev1' });
        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should accumulate items across multiple pages until hasNextPage is false', async () => {
        vi.mocked(mockMCP.callTool)
          .mockResolvedValueOnce({
            items: [{ number: 1 }, { number: 2 }],
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
          })
          .mockResolvedValueOnce({
            items: [{ number: 3 }, { number: 4 }],
            pageInfo: { hasNextPage: false },
          });

        const issues = await api.listIssues({ milestone: 'v2.0' });
        expect(issues).toHaveLength(4);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(2);
      });

      it('should stop without extra MCP call when accumulated.length reaches limit at page boundary', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
        });

        const issues = await api.listIssues({ milestone: 'v1.0', limit: 2 });
        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should truncate returned items to limit when defined', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }],
          pageInfo: { hasNextPage: false },
        });

        const issues = await api.listIssues({ assignee: 'dev1', limit: 3 });
        expect(issues).toHaveLength(3);
      });

      it('should fall back to stopping on items.length < perPage when pageInfo is absent', async () => {
        vi.mocked(mockMCP.callTool)
          .mockResolvedValueOnce({
            items: [{ number: 1 }, { number: 2 }],
          });

        const issues = await api.listIssues({ milestone: 'v1.0' });
        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should build the correct query with repo, is:issue, state, labels, milestone, and assignee', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ milestone: 'v1.0', assignee: 'dev1', labels: ['bug'], state: 'open' });

        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringMatching(/repo:owner\/repo/),
        }));
        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('is:issue'),
        }));
        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('is:open'),
        }));
        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('label:"bug"'),
        }));
        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('milestone:"v1.0"'),
        }));
        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('assignee:dev1'),
        }));
      });
    });

    describe('searchIssuesWithFilters cursor-based pagination', () => {
      it('should make first search_issues call without an after parameter', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ milestone: 'v1.0' });

        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.not.objectContaining({
          after: expect.anything(),
        }));
      });

      it('should pass endCursor as after on subsequent search_issues pages', async () => {
        vi.mocked(mockMCP.callTool)
          .mockResolvedValueOnce({
            items: [{ number: 1 }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-xyz' },
          })
          .mockResolvedValueOnce({
            items: [{ number: 2 }],
            pageInfo: { hasNextPage: false },
          });

        await api.listIssues({ milestone: 'v1.0' });

        expect(mockMCP.callTool).toHaveBeenNthCalledWith(2, 'search_issues', expect.objectContaining({
          after: 'cursor-xyz',
        }));
      });

      it('should stop when pageInfo.hasNextPage is false', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-end' },
        });

        const issues = await api.listIssues({ milestone: 'v1.0' });

        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should paginate through multiple pages using cursors', async () => {
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

      it('should stop when accumulated length reaches limit even if hasNextPage is true', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
        });

        const issues = await api.listIssues({ assignee: 'dev1', limit: 2 });

        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should truncate results to limit when page returns more items than needed', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }],
          pageInfo: { hasNextPage: false },
        });

        const issues = await api.listIssues({ milestone: 'v1.0', limit: 3 });

        expect(issues).toHaveLength(3);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should use perPage equal to remaining when limit is less than 100', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ milestone: 'v1.0', limit: 25 });

        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          perPage: 25,
        }));
      });

      it('should fall back to legacy termination when pageInfo is absent and items < perPage', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [{ number: 1 }, { number: 2 }],
          // no pageInfo
        });

        const issues = await api.listIssues({ assignee: 'dev1' });

        expect(issues).toHaveLength(2);
        expect(mockMCP.callTool).toHaveBeenCalledTimes(1);
      });

      it('should build query with state filter for search_issues', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ milestone: 'v2.0', state: 'open' });

        expect(mockMCP.callTool).toHaveBeenCalledWith('search_issues', expect.objectContaining({
          query: expect.stringContaining('is:open'),
        }));
      });

      it('should build query with label filters for search_issues', async () => {
        vi.mocked(mockMCP.callTool).mockResolvedValueOnce({
          items: [],
          pageInfo: { hasNextPage: false },
        });

        await api.listIssues({ assignee: 'dev1', labels: ['bug', 'enhancement'] });

        const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0][1] as Record<string, unknown>;
        expect(callArgs.query).toContain('label:"bug"');
        expect(callArgs.query).toContain('label:"enhancement"');
      });
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
  });
});
