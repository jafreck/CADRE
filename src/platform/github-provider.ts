import type {
  PlatformProvider,
  IssueDetail,
  IssueComment,
  PullRequestInfo,
  CreatePullRequestParams,
  ListPullRequestsParams,
  ListIssuesParams,
} from './provider.js';
import { GitHubMCPClient, type MCPServerConfig } from '../github/mcp-client.js';
import { GitHubAPI } from '../github/api.js';
import { Logger } from '../logging/logger.js';

/**
 * GitHub implementation of PlatformProvider.
 *
 * Delegates all operations to GitHubAPI / GitHubMCPClient,
 * normalizing responses to the platform-agnostic types.
 */
export class GitHubProvider implements PlatformProvider {
  readonly name = 'GitHub';

  private readonly mcpClient: GitHubMCPClient;
  private api: GitHubAPI | null = null;
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly repository: string,
    private readonly mcpServerConfig: MCPServerConfig,
    private readonly logger: Logger,
  ) {
    const [owner, repo] = repository.split('/');
    this.owner = owner;
    this.repo = repo;
    this.mcpClient = new GitHubMCPClient(mcpServerConfig, logger);
  }

  // ── Lifecycle ──

  async connect(): Promise<void> {
    await this.mcpClient.connect();
    this.api = new GitHubAPI(this.repository, this.logger, this.mcpClient);
  }

  async disconnect(): Promise<void> {
    await this.mcpClient.disconnect();
    this.api = null;
  }

  async checkAuth(): Promise<boolean> {
    return this.mcpClient.checkAuth();
  }

  // ── Issues ──

  async getIssue(issueNumber: number): Promise<IssueDetail> {
    const raw = await this.getAPI().getIssue(issueNumber);
    return this.parseIssue(raw);
  }

  async listIssues(filters: ListIssuesParams): Promise<IssueDetail[]> {
    const rawIssues = await this.getAPI().listIssues(filters);
    const issues: IssueDetail[] = [];

    for (const raw of rawIssues) {
      const issueNumber = raw.number as number;
      try {
        const detail = await this.getIssue(issueNumber);
        issues.push(detail);
      } catch (err) {
        this.logger.warn(`Failed to fetch details for issue #${issueNumber}: ${err}`, {
          issueNumber,
        });
      }
    }

    return issues;
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.getAPI().addIssueComment(issueNumber, body);
  }

  // ── Pull Requests ──

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    const result = await this.getAPI().createPullRequest(params);
    return {
      number: result.number as number,
      url: (result.html_url as string) ?? (result.url as string) ?? '',
      title: (result.title as string) ?? params.title,
      headBranch: params.head,
      baseBranch: params.base,
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
    const result = await this.getAPI().getPullRequest(prNumber);
    return {
      number: result.number as number,
      url: (result.html_url as string) ?? (result.url as string) ?? '',
      title: (result.title as string) ?? '',
      headBranch: ((result.head as Record<string, unknown>)?.ref as string) ?? '',
      baseBranch: ((result.base as Record<string, unknown>)?.ref as string) ?? '',
    };
  }

  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    await this.getAPI().updatePullRequest(prNumber, updates);
  }

  async listPullRequests(filters?: ListPullRequestsParams): Promise<PullRequestInfo[]> {
    // Adjust head filter — GitHubAPI prefixes with "owner:"
    const result = await this.getAPI().listPullRequests(filters);
    return result.map((pr) => ({
      number: pr.number as number,
      url: (pr.html_url as string) ?? (pr.url as string) ?? '',
      title: (pr.title as string) ?? '',
      headBranch: ((pr.head as Record<string, unknown>)?.ref as string) ?? '',
      baseBranch: ((pr.base as Record<string, unknown>)?.ref as string) ?? '',
    }));
  }

  // ── Issue Linking ──

  issueLinkSuffix(issueNumber: number): string {
    return `Closes #${issueNumber}`;
  }

  // ── Helpers ──

  private getAPI(): GitHubAPI {
    if (!this.api) {
      throw new Error('GitHubProvider not connected — call connect() first');
    }
    return this.api;
  }

  private parseIssue(raw: Record<string, unknown>): IssueDetail {
    const labels =
      (raw.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [];
    const assignees =
      (raw.assignees as Array<{ login: string }> | undefined)?.map((a) => a.login) ?? [];
    const rawComments = (raw.comments as Array<Record<string, unknown>>) ?? [];

    const comments: IssueComment[] = rawComments.map((c) => ({
      author: ((c.author as Record<string, unknown>)?.login as string) ?? 'unknown',
      body: (c.body as string) ?? '',
      createdAt: (c.createdAt as string) ?? '',
    }));

    const milestone = raw.milestone
      ? ((raw.milestone as Record<string, unknown>).title as string)
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
      linkedPRs: [],
    };
  }
}
