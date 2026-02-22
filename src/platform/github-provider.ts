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

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

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
      const issueNumber = asNumber(raw.number);
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
      number: asNumber(result.number),
      url: asString(result.html_url) || asString(result.url),
      title: asString(result.title) || params.title,
      headBranch: params.head,
      baseBranch: params.base,
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
    const result = await this.getAPI().getPullRequest(prNumber);
    return {
      number: asNumber(result.number),
      url: asString(result.html_url) || asString(result.url),
      title: asString(result.title),
      headBranch: asString(asRecord(result.head).ref),
      baseBranch: asString(asRecord(result.base).ref),
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
      number: asNumber(pr.number),
      url: asString(pr.html_url) || asString(pr.url),
      title: asString(pr.title),
      headBranch: asString(asRecord(pr.head).ref),
      baseBranch: asString(asRecord(pr.base).ref),
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
    const labels = asArray(raw.labels).map((l) => asString(asRecord(l).name));
    const assignees = asArray(raw.assignees).map((a) => asString(asRecord(a).login));
    const rawComments = asArray(raw.comments);

    const comments: IssueComment[] = rawComments.map((c) => ({
      author: asString(asRecord(asRecord(c).author).login, 'unknown'),
      body: asString(asRecord(c).body),
      createdAt: asString(asRecord(c).createdAt),
    }));

    const milestone = raw.milestone
      ? asString(asRecord(raw.milestone).title)
      : undefined;

    return {
      number: asNumber(raw.number),
      title: asString(raw.title),
      body: asString(raw.body),
      labels,
      assignees,
      milestone,
      comments,
      state: raw.state === 'closed' ? 'closed' : 'open',
      createdAt: asString(raw.createdAt),
      updatedAt: asString(raw.updatedAt),
      linkedPRs: [],
    };
  }
}
