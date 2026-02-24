import type {
  PlatformProvider,
  IssueDetail,
  IssueComment,
  PullRequestInfo,
  CreatePullRequestParams,
  ListPullRequestsParams,
  ListIssuesParams,
  ReviewThread,
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

  async findOpenPR(issueNumber: number, branch: string): Promise<PullRequestInfo | null> {
    const prs = await this.listPullRequests({ head: branch, state: 'open' });
    return prs.find((pr) => pr.headBranch === branch) ?? null;
  }

  // ── Issue Linking ──

  issueLinkSuffix(issueNumber: number): string {
    return `Closes #${issueNumber}`;
  }

  async listPRReviewComments(prNumber: number): Promise<ReviewThread[]> {
    const raw = await this.getAPI().getPRReviewComments(prNumber);
    return this.parseReviewThreads(prNumber, raw);
  }

  // ── Helpers ──

  private getAPI(): GitHubAPI {
    if (!this.api) {
      throw new Error('GitHubProvider not connected — call connect() first');
    }
    return this.api;
  }

  private parseReviewThreads(prNumber: number, raw: unknown): ReviewThread[] {
    // The MCP get_review_comments response is { reviewThreads: [...], pageInfo: {...}, totalCount: N }
    // with Go-serialized capitalized field names (ID, IsResolved, IsOutdated, Comments.Nodes, etc.)
    // It may also be a plain array of threads (legacy / test format).
    let threads: unknown[];
    if (Array.isArray(raw)) {
      threads = raw;
    } else if (raw !== null && typeof raw === 'object') {
      const envelope = raw as Record<string, unknown>;
      if ('reviewThreads' in envelope) {
        threads = asArray(envelope.reviewThreads);
      } else if ('threads' in envelope) {
        threads = asArray(envelope.threads);
      } else {
        return [];
      }
    } else {
      return [];
    }

    return threads.map((t) => {
      const thread = asRecord(t);

      // Support both Go-serialized capitalized keys (MCP server) and lowercase (tests/legacy)
      const rawCommentsContainer = thread.Comments ?? thread.comments;
      const rawComments = Array.isArray(rawCommentsContainer)
        ? rawCommentsContainer
        : asArray(asRecord(rawCommentsContainer).Nodes ?? asRecord(rawCommentsContainer).nodes);

      const comments = rawComments.map((c) => {
        const comment = asRecord(c);
        const authorContainer = comment.Author ?? comment.author;
        const author = asRecord(authorContainer);
        const login = asString(author.Login ?? author.login, 'unknown');

        const lineVal = comment.Line ?? comment.line;
        return {
          id: asString(comment.ID ?? comment.id),
          author: login,
          body: asString(comment.Body ?? comment.body),
          createdAt: asString(comment.CreatedAt ?? comment.createdAt),
          path: asString(comment.Path ?? comment.path),
          line: typeof lineVal === 'number' ? lineVal : undefined,
        };
      });

      const isResolved = thread.IsResolved ?? thread.isResolved;
      const isOutdated = thread.IsOutdated ?? thread.isOutdated;

      return {
        id: asString(thread.ID ?? thread.id),
        prNumber,
        isResolved: isResolved === true,
        isOutdated: isOutdated === true,
        comments,
      };
    });
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
