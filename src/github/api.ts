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

    const args: Record<string, unknown> = {
      owner: this.owner,
      repo: this.repo,
    };

    if (filters.state) {
      args.state = filters.state;
    }
    if (filters.labels && filters.labels.length > 0) {
      args.labels = filters.labels;
    }
    if (filters.limit) {
      args.perPage = Math.min(filters.limit, 100);
    }

    // The list_issues MCP tool returns a paginated envelope: { issues, pageInfo, totalCount }
    const result = await this.mcp.callTool<
      Record<string, unknown>[] | { issues: Record<string, unknown>[] }
    >('list_issues', args);

    // Unwrap paginated envelope if present
    if (result && !Array.isArray(result) && 'issues' in result) {
      return (result as { issues: Record<string, unknown>[] }).issues;
    }

    return result as Record<string, unknown>[];
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
    labels?: string[];
    reviewers?: string[];
  }): Promise<Record<string, unknown>> {
    const args: Record<string, unknown> = {
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    };

    // Note: the create_pull_request MCP tool does not accept `labels` or
    // `reviewers` — those fields are not in its input schema and are silently
    // dropped.  We apply them in separate calls after the PR is created.

    const result = await this.mcp.callTool<Record<string, unknown>>('create_pull_request', args);

    const prNumber = result.number as number | undefined;
    if (prNumber) {
      // Add labels via the Issues API (PRs are a type of issue in GitHub).
      if (params.labels && params.labels.length > 0) {
        try {
          await this.mcp.callTool('issue_write', {
            method: 'update',
            owner: this.owner,
            repo: this.repo,
            issue_number: prNumber,
            labels: params.labels,
          });
        } catch (err) {
          this.logger.warn(`Failed to set labels on PR #${prNumber}: ${err}`);
        }
      }

      // Request reviewers via the PR update endpoint.
      if (params.reviewers && params.reviewers.length > 0) {
        try {
          await this.mcp.callTool('update_pull_request', {
            owner: this.owner,
            repo: this.repo,
            pullNumber: prNumber,
            reviewers: params.reviewers,
          });
        } catch (err) {
          this.logger.warn(`Failed to set reviewers on PR #${prNumber}: ${err}`);
        }
      }
    }

    return result;
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
   * Get regular conversation comments on a pull request (issue-style, not review threads).
   */
  async getPRComments(prNumber: number): Promise<unknown> {
    return this.mcp.callTool<unknown>('pull_request_read', {
      method: 'get_comments',
      owner: this.owner,
      repo: this.repo,
      pullNumber: prNumber,
    });
  }

  /**
   * Get review comments for a pull request.
   */
  async getPRReviewComments(prNumber: number): Promise<unknown> {
    return this.mcp.callTool<unknown>('pull_request_read', {
      method: 'get_review_comments',
      owner: this.owner,
      repo: this.repo,
      pullNumber: prNumber,
    });
  }

  /**
   * Get top-level reviews for a pull request (review bodies, not inline threads).
   */
  async getPRReviews(prNumber: number): Promise<unknown> {
    return this.mcp.callTool<unknown>('pull_request_read', {
      method: 'get_reviews',
      owner: this.owner,
      repo: this.repo,
      pullNumber: prNumber,
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

  // ── Labels ──

  /**
   * Ensure a label exists in the repository, creating it if it does not.
   * Silently ignores 422 "already exists" errors.
   */
  async ensureLabel(labelName: string, color = 'ededed'): Promise<void> {
    try {
      await this.mcp.callTool('create_label', {
        owner: this.owner,
        repo: this.repo,
        name: labelName,
        color,
      });
    } catch (err) {
      const message = String(err);
      // GitHub returns 422 when the label already exists — safe to ignore
      if (!message.includes('422') && !message.toLowerCase().includes('already exists')) {
        this.logger.warn(`Failed to create label "${labelName}": ${err}`);
      }
    }
  }

  /**
   * Add labels to a pull request without clobbering existing ones.
   * Fetches current labels first, merges, then updates.
   */
  async applyLabels(prNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    try {
      // Fetch current labels so we don't clobber them — GitHub's issue update
      // API replaces the full label set when `labels` is provided.
      let existingLabels: string[] = [];
      try {
        const issue = await this.mcp.callTool<Record<string, unknown>>('issue_read', {
          method: 'get',
          owner: this.owner,
          repo: this.repo,
          issue_number: prNumber,
        });
        const rawLabels = issue.labels;
        if (Array.isArray(rawLabels)) {
          existingLabels = rawLabels
            .map((l) => (typeof l === 'string' ? l : (l as Record<string, unknown>).name as string))
            .filter(Boolean);
        }
      } catch {
        // If we can't fetch current labels, proceed with only the supplied ones.
      }
      const merged = Array.from(new Set([...existingLabels, ...labels]));
      await this.mcp.callTool('issue_write', {
        method: 'update',
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        labels: merged,
      });
    } catch (err) {
      this.logger.warn(`Failed to apply labels to PR #${prNumber}: ${err}`);
    }
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

    const result = await this.mcp.callTool<Record<string, unknown>>('search_issues', {
      query: queryParts.join(' '),
      perPage: filters.limit ?? 30,
    });

    return (result.items as Record<string, unknown>[]) ?? [];
  }
}
