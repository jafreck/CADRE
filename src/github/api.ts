import { Octokit } from '@octokit/rest';
import { Logger } from '../logging/logger.js';

/**
 * GitHub API layer backed by the Octokit REST client.
 */
export class GitHubAPI {
  private readonly owner: string;
  private readonly repo: string;
  private readonly octokit: Octokit;

  constructor(
    private readonly repository: string,
    private readonly logger: Logger,
    octokit?: Octokit,
  ) {
    const [owner, repo] = repository.split('/');
    this.owner = owner;
    this.repo = repo;
    this.octokit = octokit ?? new Octokit({ auth: process.env.GITHUB_TOKEN });
  }

  // ── Issues ──

  /**
   * Get full issue details including comments.
   */
  async getIssue(issueNumber: number): Promise<Record<string, unknown>> {
    const { data: issue } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    let comments: unknown[] = [];
    try {
      const { data } = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });
      comments = data;
    } catch {
      this.logger.debug(`Could not fetch comments for issue #${issueNumber}`);
    }

    return { ...(issue as unknown as Record<string, unknown>), comments };
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
    const needsSearch = filters.milestone || filters.assignee;

    if (needsSearch) {
      return this.searchIssuesWithFilters(filters);
    }

    const params: Parameters<typeof this.octokit.rest.issues.listForRepo>[0] = {
      owner: this.owner,
      repo: this.repo,
    };

    if (filters.state) {
      params.state = filters.state as 'open' | 'closed' | 'all';
    }
    if (filters.labels && filters.labels.length > 0) {
      params.labels = filters.labels.join(',');
    }
    if (filters.limit) {
      params.per_page = Math.min(filters.limit, 100);
    }

    const issues = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, params);
    return issues as unknown as Record<string, unknown>[];
  }

  /**
   * Add a comment to an issue.
   */
  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({
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
    const { data: pr } = await this.octokit.rest.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    });

    const prNumber = pr.number;

    // Add labels via the Issues API (PRs are a type of issue in GitHub).
    if (params.labels && params.labels.length > 0) {
      try {
        await this.octokit.rest.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: prNumber,
          labels: params.labels,
        });
      } catch (err) {
        this.logger.warn(`Failed to set labels on PR #${prNumber}: ${err}`);
      }
    }

    // Request reviewers via the PR review requests endpoint.
    if (params.reviewers && params.reviewers.length > 0) {
      try {
        await this.octokit.rest.pulls.requestReviewers({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          reviewers: params.reviewers,
        });
      } catch (err) {
        this.logger.warn(`Failed to set reviewers on PR #${prNumber}: ${err}`);
      }
    }

    return pr as unknown as Record<string, unknown>;
  }

  /**
   * Get a pull request by number.
   */
  async getPullRequest(prNumber: number): Promise<Record<string, unknown>> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return data as unknown as Record<string, unknown>;
  }

  /**
   * Update an existing pull request.
   */
  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    await this.octokit.rest.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      ...updates,
    });
  }

  /**
   * Get regular conversation comments on a pull request (issue-style, not review threads).
   */
  async getPRComments(prNumber: number): Promise<unknown> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
    });
    return data;
  }

  /**
   * Get review comments for a pull request, grouped into thread-shaped objects.
   *
   * Octokit returns flat comment objects; this method groups them by thread
   * (root comment + replies) so that parseReviewThreads in github-provider.ts
   * can consume them correctly.
   */
  async getPRReviewComments(prNumber: number): Promise<unknown> {
    const { data } = await this.octokit.rest.pulls.listReviewComments({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    // Group flat comments into thread-shaped objects.
    // Root comments have no in_reply_to_id; replies reference the root via in_reply_to_id.
    type RawComment = (typeof data)[number];
    const threadComments = new Map<number, RawComment[]>();
    const rootComments: RawComment[] = [];

    for (const comment of data) {
      if (!comment.in_reply_to_id) {
        rootComments.push(comment);
        if (!threadComments.has(comment.id)) {
          threadComments.set(comment.id, [comment]);
        }
      } else {
        const existing = threadComments.get(comment.in_reply_to_id);
        if (existing) {
          existing.push(comment);
        } else {
          threadComments.set(comment.in_reply_to_id, [comment]);
        }
      }
    }

    return rootComments.map((root) => ({
      id: String(root.id),
      isResolved: false,
      isOutdated: false,
      comments: (threadComments.get(root.id) ?? [root]).map((c) => ({
        id: String(c.id),
        author: { login: c.user?.login ?? 'unknown' },
        body: c.body,
        createdAt: c.created_at,
        path: c.path,
        line: c.line ?? c.original_line,
      })),
    }));
  }

  /**
   * Get top-level reviews for a pull request (review bodies, not inline threads).
   */
  async getPRReviews(prNumber: number): Promise<unknown> {
    const { data } = await this.octokit.rest.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return data;
  }

  /**
   * List pull requests, optionally filtered by head branch.
   */
  async listPullRequests(filters?: {
    head?: string;
    base?: string;
    state?: string;
  }): Promise<Record<string, unknown>[]> {
    const params: Parameters<typeof this.octokit.rest.pulls.list>[0] = {
      owner: this.owner,
      repo: this.repo,
    };

    if (filters?.head) {
      params.head = `${this.owner}:${filters.head}`;
    }
    if (filters?.base) {
      params.base = filters.base;
    }
    if (filters?.state) {
      params.state = filters.state as 'open' | 'closed' | 'all';
    }

    const { data } = await this.octokit.rest.pulls.list(params);
    return data as unknown as Record<string, unknown>[];
  }

  // ── Labels ──

  /**
   * Ensure a label exists in the repository, creating it if it does not.
   * Silently ignores 422 "already exists" errors.
   */
  async ensureLabel(labelName: string, color = 'ededed'): Promise<void> {
    try {
      await this.octokit.rest.issues.createLabel({
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
   * Uses the addLabels API which appends to (not replaces) the existing label set.
   */
  async applyLabels(prNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        labels,
      });
    } catch (err) {
      this.logger.warn(`Failed to apply labels to PR #${prNumber}: ${err}`);
    }
  }

  // ── Auth ──

  /**
   * Check if the Octokit client is authenticated.
   */
  async checkAuth(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
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

    const items = await this.octokit.paginate(this.octokit.rest.search.issuesAndPullRequests, {
      q: queryParts.join(' '),
      per_page: filters.limit ?? 30,
    });

    return items as unknown as Record<string, unknown>[];
  }
}
