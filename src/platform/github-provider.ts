import type {
  PlatformProvider,
  IssueDetail,
  IssueComment,
  PullRequestInfo,
  CreatePullRequestParams,
  ListPullRequestsParams,
  ListIssuesParams,
  ReviewThread,
  PRComment,
  PRReview,
  PullRequestMergeMethod,
} from './provider.js';
import { GitHubAPI } from '../github/api.js';
import { Logger } from '../logging/logger.js';
import { Octokit } from '@octokit/rest';

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

const MERGE_POLL_INTERVAL_MS = 15_000;
const MERGE_POLL_TIMEOUT_MS = 30 * 60_000;

function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const value = err as { status?: unknown; response?: { status?: unknown } };
    if (typeof value.status === 'number') return value.status;
    if (typeof value.response?.status === 'number') return value.response.status;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GitHub implementation of PlatformProvider.
 *
 * Delegates all operations to GitHubAPI, normalizing responses to the
 * platform-agnostic types.
 */
export class GitHubProvider implements PlatformProvider {
  readonly name = 'GitHub';

  private api: GitHubAPI | null = null;
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly repository: string,
    private readonly logger: Logger,
    private readonly octokit?: Octokit,
  ) {
    const [owner, repo] = repository.split('/');
    this.owner = owner;
    this.repo = repo;
  }

  // ── Lifecycle ──

  async connect(): Promise<void> {
    this.api = new GitHubAPI(this.repository, this.logger, this.octokit);
  }

  async disconnect(): Promise<void> {
    this.api = null;
  }

  async checkAuth(): Promise<boolean> {
    return this.getAPI().checkAuth();
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
      state: 'open',
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
    const result = await this.getAPI().getPullRequest(prNumber);
    const ghState = asString(result.state);
    const merged = !!(result.merged || result.merged_at);
    return {
      number: asNumber(result.number),
      url: asString(result.html_url) || asString(result.url),
      title: asString(result.title),
      headBranch: asString(asRecord(result.head).ref),
      baseBranch: asString(asRecord(result.base).ref),
      state: merged ? 'merged' : ghState === 'closed' ? 'closed' : 'open',
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
    return result.map((pr) => {
      const ghState = asString(pr.state);
      const merged = !!pr.merged_at;
      const prState: PullRequestInfo['state'] = merged ? 'merged' : ghState === 'closed' ? 'closed' : 'open';
      return {
        number: asNumber(pr.number),
        url: asString(pr.html_url) || asString(pr.url),
        title: asString(pr.title),
        headBranch: asString(asRecord(pr.head).ref),
        baseBranch: asString(asRecord(pr.base).ref),
        state: prState,
      };
    });
  }

  async findOpenPR(issueNumber: number, branch: string): Promise<PullRequestInfo | null> {
    const prs = await this.listPullRequests({ head: branch, state: 'open' });
    return prs.find((pr) => pr.headBranch === branch) ?? null;
  }

  async mergePullRequest(
    prNumber: number,
    _baseBranch: string,
    mergeMethod: PullRequestMergeMethod = 'merge',
  ): Promise<void> {
    const oct = this.octokit ?? new Octokit({ auth: process.env.GITHUB_TOKEN });
    try {
      await oct.rest.pulls.merge({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        merge_method: mergeMethod,
      });
      return;
    } catch (err) {
      const status = extractStatusCode(err);
      const canRetry = status === 405 || status === 409 || status === 422;
      if (!canRetry || !this.supportsMergeMonitoring(oct)) {
        throw err;
      }

      this.logger.info(`PR #${prNumber} is not mergeable yet; waiting for checks and branch freshness`, {
        data: { prNumber, status },
      });
    }

    await this.waitForMergeReadiness(oct, prNumber);

    await oct.rest.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    });
  }

  // ── Labels ──

  async ensureLabel(labelName: string, color?: string): Promise<void> {
    await this.getAPI().ensureLabel(labelName, color);
  }

  async applyLabels(prNumber: number, labels: string[]): Promise<void> {
    await this.getAPI().applyLabels(prNumber, labels);
  }

  // ── Issue Linking ──

  issueLinkSuffix(issueNumber: number): string {
    return `Closes #${issueNumber}`;
  }

  async listPRReviewComments(prNumber: number): Promise<ReviewThread[]> {
    const raw = await this.getAPI().getPRReviewComments(prNumber);
    return this.parseReviewThreads(prNumber, raw);
  }

  async listPRComments(prNumber: number): Promise<PRComment[]> {
    const raw = await this.getAPI().getPRComments(prNumber);
    return this.parsePRComments(raw);
  }

  async listPRReviews(prNumber: number): Promise<PRReview[]> {
    const raw = await this.getAPI().getPRReviews(prNumber);
    return this.parsePRReviews(prNumber, raw);
  }

  private parsePRReviews(_prNumber: number, raw: unknown): PRReview[] {
    let items: unknown[];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (raw !== null && typeof raw === 'object') {
      const envelope = raw as Record<string, unknown>;
      // Some API versions wrap reviews in an envelope
      items = Array.isArray(envelope.reviews) ? envelope.reviews : [];
    } else {
      return [];
    }

    return items.map((item) => {
      const r = item as Record<string, unknown>;
      const userObj = (r.user ?? r.author ?? {}) as Record<string, unknown>;
      const login = String(userObj.login ?? userObj.Login ?? 'unknown');
      const isBot = login.includes('[bot]') || String(userObj.type ?? '').toLowerCase() === 'bot';
      return {
        id: String(r.id ?? ''),
        author: login,
        isBot,
        body: String(r.body ?? ''),
        state: String(r.state ?? ''),
        submittedAt: String(r.submitted_at ?? r.submittedAt ?? ''),
      };
    });
  }

  private parsePRComments(raw: unknown): PRComment[] {
    let items: unknown[];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (raw !== null && typeof raw === 'object') {
      const envelope = raw as Record<string, unknown>;
      items = Array.isArray(envelope.comments) ? envelope.comments : [];
    } else {
      return [];
    }

    return items.map((item) => {
      const c = item as Record<string, unknown>;
      const userObj = (c.user ?? c.author ?? {}) as Record<string, unknown>;
      const login = String(userObj.login ?? userObj.Login ?? 'unknown');
      const isBot = login.includes('[bot]') || String(userObj.type ?? '').toLowerCase() === 'bot';
      return {
        id: String(c.id ?? ''),
        author: login,
        isBot,
        body: String(c.body ?? ''),
        createdAt: String(c.created_at ?? c.createdAt ?? ''),
        url: String(c.html_url ?? c.url ?? ''),
      };
    });
  }

  // ── Helpers ──

  private supportsMergeMonitoring(oct: Octokit): boolean {
    const rest = (oct as unknown as { rest?: Record<string, unknown> }).rest;
    if (!rest) return false;
    const pulls = rest.pulls as Record<string, unknown> | undefined;
    const repos = rest.repos as Record<string, unknown> | undefined;
    const checks = rest.checks as Record<string, unknown> | undefined;
    return (
      typeof pulls?.get === 'function'
      && typeof pulls?.updateBranch === 'function'
      && typeof repos?.getCombinedStatusForRef === 'function'
      && typeof checks?.listForRef === 'function'
    );
  }

  private async waitForMergeReadiness(oct: Octokit, prNumber: number): Promise<void> {
    const deadline = Date.now() + MERGE_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const { data: pr } = await oct.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      if (pr.merged) return;
      if (pr.state === 'closed') {
        throw new Error(`PR #${prNumber} closed before auto-complete could finish`);
      }

      const headSha = pr.head?.sha;
      if (!headSha) {
        throw new Error(`PR #${prNumber} has no head SHA; cannot monitor checks`);
      }

      const mergeableState = (pr as { mergeable_state?: string }).mergeable_state;
      if (mergeableState === 'behind') {
        try {
          await oct.rest.pulls.updateBranch({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
          });
          this.logger.info(`Queued base-branch update for PR #${prNumber}`);
        } catch (err) {
          this.logger.warn(`Could not update PR #${prNumber} branch from base: ${String(err)}`);
        }
      }

      const checks = await this.getCheckHealth(oct, headSha);
      if (checks.failed.length > 0) {
        throw new Error(`PR #${prNumber} checks failed: ${checks.failed.join(', ')}`);
      }

      const isMergeable = pr.mergeable === true;
      if (!checks.pending && isMergeable) {
        return;
      }

      await sleep(MERGE_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for PR #${prNumber} checks/mergeability`);
  }

  private async getCheckHealth(
    oct: Octokit,
    headSha: string,
  ): Promise<{ pending: boolean; failed: string[] }> {
    const failed: string[] = [];
    let pending = false;

    const combined = await oct.rest.repos.getCombinedStatusForRef({
      owner: this.owner,
      repo: this.repo,
      ref: headSha,
    });
    if (combined.data.state === 'pending') pending = true;
    if (combined.data.state === 'failure' || combined.data.state === 'error') {
      const statuses = combined.data.statuses ?? [];
      for (const status of statuses) {
        if (status.state === 'failure' || status.state === 'error') {
          failed.push(status.context || 'commit-status');
        }
      }
      if (failed.length === 0) failed.push('commit-status');
    }

    const checkRunsResult = await oct.rest.checks.listForRef({
      owner: this.owner,
      repo: this.repo,
      ref: headSha,
      per_page: 100,
    });

    for (const run of checkRunsResult.data.check_runs) {
      if (run.status !== 'completed') {
        pending = true;
        continue;
      }
      const conclusion = run.conclusion ?? 'neutral';
      if (
        conclusion === 'failure'
        || conclusion === 'timed_out'
        || conclusion === 'cancelled'
        || conclusion === 'action_required'
        || conclusion === 'startup_failure'
      ) {
        failed.push(run.name);
      }
    }

    return { pending, failed };
  }

  private getAPI(): GitHubAPI {
    if (!this.api) {
      throw new Error('GitHubProvider not connected — call connect() first');
    }
    return this.api;
  }

  private parseReviewThreads(prNumber: number, raw: unknown): ReviewThread[] {
    // The get_review_comments response may be { reviewThreads: [...], pageInfo: {...}, totalCount: N }
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

      // Support both Go-serialized capitalized keys and lowercase (tests/legacy)
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
