import type { Logger } from '../logging/logger.js';

/**
 * Comment on an issue or work item.
 */
export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

/**
 * Normalized representation of an issue or work item across platforms.
 */
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
  linkedPRs: number[];
}

/**
 * Normalized pull request information.
 */
export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  headBranch: string;
  baseBranch: string;
}

/**
 * Parameters for creating a pull request.
 */
export interface CreatePullRequestParams {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  labels?: string[];
  reviewers?: string[];
}

/**
 * A single comment within a pull request review thread.
 */
export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line?: number;
}

/**
 * A top-level pull request review (submitted via the Reviews API, with an optional body).
 */
export interface PRReview {
  id: string;
  author: string;
  /** Whether the author account is a bot (e.g. github-actions[bot]). */
  isBot: boolean;
  body: string;
  /** Review state: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, etc. */
  state: string;
  submittedAt: string;
}

/**
 * A regular (non-review) pull request comment (issue-style comment on the PR conversation).
 */
export interface PRComment {
  id: string;
  author: string;
  /** Whether the author account is a bot (e.g. codecov[bot], dependabot[bot]). */
  isBot: boolean;
  body: string;
  createdAt: string;
  url: string;
}

/**
 * A pull request review thread, grouping one or more comments on the same code location.
 */
export interface ReviewThread {
  id: string;
  prNumber: number;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewComment[];
}

/**
 * Parameters for listing pull requests.
 */
export interface ListPullRequestsParams {
  head?: string;
  base?: string;
  state?: string;
}

/**
 * Parameters for listing/searching issues.
 */
export interface ListIssuesParams {
  labels?: string[];
  milestone?: string;
  assignee?: string;
  state?: string;
  limit?: number;
}

/**
 * Platform-agnostic interface for issue tracking and pull request management.
 *
 * Implementations exist for GitHub (via MCP server) and Azure DevOps (via REST API).
 * The runtime selects the appropriate provider based on `platform` in the config.
 */
export interface PlatformProvider {
  /** Human-readable platform name (e.g. "GitHub", "Azure DevOps"). */
  readonly name: string;

  // ── Lifecycle ──

  /** Connect to the platform (e.g. start MCP server, validate credentials). */
  connect(): Promise<void>;

  /** Disconnect and clean up resources. */
  disconnect(): Promise<void>;

  /** Verify that authentication is valid. Returns true if authenticated. */
  checkAuth(): Promise<boolean>;

  // ── Issues / Work Items ──

  /** Fetch a single issue/work item by number/ID, including comments. */
  getIssue(issueNumber: number): Promise<IssueDetail>;

  /** List issues/work items matching the given filters. */
  listIssues(filters: ListIssuesParams): Promise<IssueDetail[]>;

  /** Add a comment to an issue/work item. */
  addIssueComment(issueNumber: number, body: string): Promise<void>;

  // ── Pull Requests ──

  /** Create a pull request. Returns the raw platform response. */
  createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo>;

  /** Get a pull request by number/ID. */
  getPullRequest(prNumber: number): Promise<PullRequestInfo>;

  /** Update an existing pull request. */
  updatePullRequest(prNumber: number, updates: { title?: string; body?: string }): Promise<void>;

  /** List pull requests matching optional filters. */
  listPullRequests(filters?: ListPullRequestsParams): Promise<PullRequestInfo[]>;

  /** Find an open pull request associated with the given issue number and branch, or null if none exists. */
  findOpenPR(issueNumber: number, branch: string): Promise<PullRequestInfo | null>;

  /** List review threads (with comments) for a pull request. */
  listPRReviewComments(prNumber: number): Promise<ReviewThread[]>;
  /** List regular (non-review) conversation comments on a pull request. */
  listPRComments(prNumber: number): Promise<PRComment[]>;
  /** List top-level pull request reviews (review bodies, not inline thread comments). */
  listPRReviews(prNumber: number): Promise<PRReview[]>;

  // ── Issue Linking ──

  /**
   * Return the body suffix that links a PR to an issue.
   * For GitHub this is "Closes #N", for Azure DevOps it uses AB# syntax.
   */
  issueLinkSuffix(issueNumber: number): string;
}

/**
 * Factory function type for creating a PlatformProvider.
 */
export type PlatformProviderFactory = (
  config: Record<string, unknown>,
  logger: Logger,
) => PlatformProvider;
