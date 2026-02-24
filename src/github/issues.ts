import { GitHubAPI } from './api.js';
import type { CadreConfig } from '../config/schema.js';
import { Logger } from '../logging/logger.js';

export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  comments: IssueComment[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  /** Linked PRs, if any. */
  linkedPRs: number[];
}

/**
 * Fetches issue details from GitHub via the MCP server.
 */
export class IssueFetcher {
  private readonly api: GitHubAPI;

  constructor(
    private readonly repository: string,
    private readonly logger: Logger,
  ) {
    this.api = new GitHubAPI(repository, logger);
  }

  /**
   * Fetch full details for a single issue (including comments).
   */
  async fetchIssue(issueNumber: number): Promise<IssueDetail> {
    this.logger.debug(`Fetching issue #${issueNumber}`, { issueNumber });

    const raw = await this.api.getIssue(issueNumber);
    return this.parseIssue(raw);
  }

  /**
   * Fetch issues matching a query (labels, milestone, etc.).
   */
  async queryIssues(query: {
    labels?: string[];
    milestone?: string;
    assignee?: string;
    state?: string;
    limit?: number;
  }): Promise<IssueDetail[]> {
    this.logger.debug('Querying issues', { data: query as Record<string, unknown> });

    const rawIssues = await this.api.listIssues(query);
    const issues: IssueDetail[] = [];

    for (const raw of rawIssues) {
      // Fetch full details including comments for each issue
      const issueNumber = raw.number as number;
      try {
        const detail = await this.fetchIssue(issueNumber);
        issues.push(detail);
      } catch (err) {
        this.logger.warn(`Failed to fetch details for issue #${issueNumber}: ${err}`, {
          issueNumber,
        });
      }
    }

    return issues;
  }

  /**
   * Resolve issue IDs from config (either explicit or query-based).
   */
  async resolveIssues(config: CadreConfig): Promise<IssueDetail[]> {
    if ('ids' in config.issues) {
      this.logger.info(`Resolving ${config.issues.ids.length} explicit issues`);
      const issues: IssueDetail[] = [];
      for (const id of config.issues.ids) {
        try {
          const issue = await this.fetchIssue(id);
          issues.push(issue);
        } catch (err) {
          this.logger.error(`Failed to fetch issue #${id}: ${err}`, { issueNumber: id });
        }
      }
      return issues;
    }

    if ('query' in config.issues) {
      const q = config.issues.query;
      this.logger.info('Resolving issues from query', { data: q as Record<string, unknown> });
      return this.queryIssues({
        labels: q.labels,
        milestone: q.milestone,
        assignee: q.assignee,
        state: q.state,
        limit: q.limit,
      });
    }

    return [];
  }

  /**
   * Parse raw `gh` JSON output into an IssueDetail.
   */
  private parseIssue(raw: Record<string, unknown>): IssueDetail {
    const labels = (raw.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [];
    const assignees = (raw.assignees as Array<{ login: string }> | undefined)?.map((a) => a.login) ?? [];
    const rawComments = (raw.comments as Array<Record<string, unknown>>) ?? [];

    const comments: IssueComment[] = rawComments.map((c) => ({
      author: (c.author as Record<string, unknown>)?.login as string ?? 'unknown',
      body: (c.body as string) ?? '',
      createdAt: (c.createdAt as string) ?? '',
    }));

    const milestone = raw.milestone
      ? (raw.milestone as Record<string, unknown>).title as string
      : undefined;

    return {
      number: raw.number as number,
      title: (raw.title as string) ?? '',
      body: (raw.body as string) ?? '',
      labels,
      assignees,
      milestone,
      comments,
      state: (raw.state as 'open' | 'closed') ?? 'open',
      createdAt: (raw.createdAt as string) ?? '',
      updatedAt: (raw.updatedAt as string) ?? '',
      linkedPRs: [], // gh doesn't readily expose this; we'd need graphql
    };
  }
}
