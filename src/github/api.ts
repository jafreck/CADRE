import { GitHubMCPClient } from './mcp-client.js';
import { Logger } from '../logging/logger.js';

/**
 * GitHub API layer backed by the GitHub MCP server.
 *
 * All interactions use structured MCP tool calls (JSON-RPC over stdio)
 * instead of shelling out to the `gh` CLI.
 */
export class GitHubAPI {
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly repository: string,
    private readonly logger: Logger,
    private readonly mcp: GitHubMCPClient,
  ) {
    const [owner, repo] = repository.split('/');
    this.owner = owner;
    this.repo = repo;
  }

  // ── Issues ──

  /**
   * Get full issue details including comments.
   */
  async getIssue(issueNumber: number): Promise<Record<string, unknown>> {
    const issue = await this.mcp.callTool<Record<string, unknown>>('issue_read', {
      method: 'get',
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    // Fetch comments separately — the MCP issue endpoint doesn't inline them
    let comments: unknown[] = [];
    try {
      const rawComments = await this.mcp.callTool<unknown[] | { comments?: unknown[] }>('issue_read', {
        method: 'get_comments',
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });
      // Normalize — some versions of the MCP server wrap comments in an envelope
      if (Array.isArray(rawComments)) {
        comments = rawComments;
      } else if (rawComments && typeof rawComments === 'object' && 'comments' in rawComments) {
        comments = (rawComments as { comments: unknown[] }).comments ?? [];
      }
    } catch {
      this.logger.debug(`Could not fetch comments for issue #${issueNumber}`);
    }

    return { ...issue, comments };
  }

  /**
   * List issues matching filters.
   */
  async listIssues(filters: {
    labels?: string[];
    milestone?: string;
    assignee?: string;
    state?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    // For milestone/assignee filtering, fall back to search_issues
    const needsSearch = filters.milestone || filters.assignee;

    if (needsSearch) {
      return this.searchIssuesWithFilters(filters);
    }

    const limit = filters.limit ?? Infinity;
    const accumulated: Record<string, unknown>[] = [];
    let after: string | undefined;

    while (accumulated.length < limit) {
      const remaining = limit - accumulated.length;
      const perPage = Math.min(remaining, 100);

      const args: Record<string, unknown> = {
        owner: this.owner,
        repo: this.repo,
        perPage,
      };

      if (filters.state) {
        args.state = filters.state;
      }
      if (filters.labels && filters.labels.length > 0) {
        args.labels = filters.labels;
      }
      if (after) {
        args.after = after;
      }

      // The list_issues MCP tool returns a paginated envelope: { issues, pageInfo, totalCount }
      const result = await this.mcp.callTool<
        | Record<string, unknown>[]
        | {
            issues: Record<string, unknown>[];
            pageInfo?: { hasNextPage: boolean; endCursor?: string };
          }
      >('list_issues', args);

      let issues: Record<string, unknown>[];
      let hasNextPage = false;

      if (result && !Array.isArray(result) && 'issues' in result) {
        issues = result.issues;
        hasNextPage = result.pageInfo?.hasNextPage ?? false;
        after = result.pageInfo?.endCursor;
      } else {
        issues = result as Record<string, unknown>[];
      }

      accumulated.push(...issues);

      if (!hasNextPage || accumulated.length >= limit) {
        break;
      }
    }

    return filters.limit !== undefined ? accumulated.slice(0, filters.limit) : accumulated;
  }

  /**
   * Add a comment to an issue.
   */
  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.mcp.callTool('add_issue_comment', {
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
  }

  // ── Pull Requests ──

  /**
   * Create a pull request.
   */
  async createPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.mcp.callTool<Record<string, unknown>>('create_pull_request', {
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    });
  }

  /**
   * Get a pull request by number.
   */
  async getPullRequest(prNumber: number): Promise<Record<string, unknown>> {
    return this.mcp.callTool<Record<string, unknown>>('pull_request_read', {
      method: 'get',
      owner: this.owner,
      repo: this.repo,
      pullNumber: prNumber,
    });
  }

  /**
   * Update an existing pull request.
   */
  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    await this.mcp.callTool('update_pull_request', {
      owner: this.owner,
      repo: this.repo,
      pullNumber: prNumber,
      ...updates,
    });
  }

  /**
   * List pull requests, optionally filtered by head branch.
   */
  async listPullRequests(filters?: {
    head?: string;
    base?: string;
    state?: string;
  }): Promise<Record<string, unknown>[]> {
    const args: Record<string, unknown> = {
      owner: this.owner,
      repo: this.repo,
    };

    if (filters?.head) {
      args.head = `${this.owner}:${filters.head}`;
    }
    if (filters?.base) {
      args.base = filters.base;
    }
    if (filters?.state) {
      args.state = filters.state;
    }

    return this.mcp.callTool<Record<string, unknown>[]>('list_pull_requests', args);
  }

  // ── Auth ──

  /**
   * Check if the MCP server is connected and authenticated.
   */
  async checkAuth(): Promise<boolean> {
    return this.mcp.checkAuth();
  }

  // ── Private helpers ──

  /**
   * Use GitHub search API for queries that need milestone/assignee filtering.
   * Paginates using the `after` cursor until results are exhausted or `limit` is reached.
   */
  private async searchIssuesWithFilters(filters: {
    labels?: string[];
    milestone?: string;
    assignee?: string;
    state?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const queryParts = [`repo:${this.repository}`, 'is:issue'];

    if (filters.state && filters.state !== 'all') {
      queryParts.push(`is:${filters.state}`);
    }
    if (filters.labels) {
      for (const label of filters.labels) {
        queryParts.push(`label:"${label}"`);
      }
    }
    if (filters.milestone) {
      queryParts.push(`milestone:"${filters.milestone}"`);
    }
    if (filters.assignee) {
      queryParts.push(`assignee:${filters.assignee}`);
    }

    const limit = filters.limit ?? Infinity;
    const accumulated: Record<string, unknown>[] = [];
    let after: string | undefined;

    while (accumulated.length < limit) {
      const remaining = limit - accumulated.length;
      const perPage = Math.min(remaining, 100);

      const args: Record<string, unknown> = {
        query: queryParts.join(' '),
        perPage,
      };
      if (after) {
        args.after = after;
      }

      const result = await this.mcp.callTool<
        | { items: Record<string, unknown>[]; pageInfo?: { hasNextPage: boolean; endCursor?: string } }
        | Record<string, unknown>
      >('search_issues', args);

      let items: Record<string, unknown>[];
      let hasNextPage = false;

      if (result && typeof result === 'object' && 'items' in result) {
        const envelope = result as { items: Record<string, unknown>[]; pageInfo?: { hasNextPage: boolean; endCursor?: string } };
        items = envelope.items ?? [];
        hasNextPage = envelope.pageInfo ? (envelope.pageInfo.hasNextPage ?? false) : items.length >= perPage;
        after = envelope.pageInfo?.endCursor;
      } else {
        items = [];
      }

      accumulated.push(...items);

      if (!hasNextPage || accumulated.length >= limit) {
        break;
      }
    }

    return filters.limit !== undefined ? accumulated.slice(0, filters.limit) : accumulated;
  }
}
