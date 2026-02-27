import type { RuntimeConfig } from '../config/loader.js';
import type { PullRequestInfo, PRComment, PRReview, ReviewThread } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { Logger } from '../logging/logger.js';

export interface IssueDiscoveryResult {
  issueNumber: number;
  pr: PullRequestInfo;
  activeThreads: ReviewThread[];
  actionableComments: PRComment[];
  actionableReviews: PRReview[];
}

export interface IssueSkipResult {
  issueNumber: number;
  skipReason: string;
}

export type DiscoveryResult = IssueDiscoveryResult | IssueSkipResult;

export function isSkipResult(result: DiscoveryResult): result is IssueSkipResult {
  return 'skipReason' in result;
}

/**
 * Discovers which issues have open PRs with actionable review feedback.
 */
export class ReviewDiscoveryService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
  ) {}

  /**
   * Discover actionable issues. If issueNumbers is provided, only those issues
   * are considered; otherwise all issues with open PRs are considered.
   */
  async discoverActionableIssues(issueNumbers?: number[]): Promise<DiscoveryResult[]> {
    const openPRs = await this.platform.listPullRequests({ state: 'open' });
    const issueToPR = this.mapIssuesToPRs(openPRs);

    const issuesToConsider =
      issueNumbers != null
        ? issueNumbers
        : Array.from(issueToPR.keys());

    const results: DiscoveryResult[] = [];

    for (const issueNumber of issuesToConsider) {
      const pr = issueToPR.get(issueNumber);
      if (!pr) {
        this.logger.info(
          `Issue #${issueNumber}: no open PR found, skipping`,
          { issueNumber },
        );
        results.push({ issueNumber, skipReason: 'no open PR' });
        continue;
      }

      const threads = await this.platform.listPRReviewComments(pr.number);
      const activeThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);

      let actionableComments: PRComment[] = [];
      try {
        const prComments = await this.platform.listPRComments(pr.number);
        actionableComments = prComments.filter((c) => !c.isBot && c.body.trim().length > 0);
      } catch (err) {
        this.logger.warn(`Issue #${issueNumber}: could not fetch PR comments: ${err}`, { issueNumber });
      }

      let actionableReviews: PRReview[] = [];
      try {
        const prReviews = await this.platform.listPRReviews(pr.number);
        actionableReviews = prReviews.filter((r) => !r.isBot && r.body.trim().length > 0);
      } catch (err) {
        this.logger.warn(`Issue #${issueNumber}: could not fetch PR reviews: ${err}`, { issueNumber });
      }

      if (activeThreads.length === 0 && actionableComments.length === 0 && actionableReviews.length === 0) {
        this.logger.info(
          `Issue #${issueNumber} (PR #${pr.number}): all review threads resolved or outdated, skipping`,
          { issueNumber },
        );
        results.push({
          issueNumber,
          skipReason: 'no unresolved review threads or PR comments',
        });
        continue;
      }

      results.push({
        issueNumber,
        pr,
        activeThreads,
        actionableComments,
        actionableReviews,
      });
    }

    return results;
  }

  /**
   * Build a map of issue number → PullRequestInfo by extracting the issue
   * number from each PR's head branch using the configured branch template.
   */
  private mapIssuesToPRs(prs: PullRequestInfo[]): Map<number, PullRequestInfo> {
    const map = new Map<number, PullRequestInfo>();

    const ISSUE_TOKEN = '\x00ISSUE\x00';
    const TITLE_TOKEN = '\x00TITLE\x00';
    const regexStr = this.config.branchTemplate
      .replace(/\{issue\}/g, ISSUE_TOKEN)
      .replace(/\{title\}/g, TITLE_TOKEN)
      .replace(/[-[\]^$.*+?(){}|\\]/g, '\\$&')
      .replace(ISSUE_TOKEN, '(\\d+)')
      .replace(TITLE_TOKEN, '[^/]+');
    const branchRegex = new RegExp(`^${regexStr}$`);

    for (const pr of prs) {
      const match = pr.headBranch.match(branchRegex);
      if (match) {
        const issueNumber = parseInt(match[1], 10);
        if (!map.has(issueNumber)) {
          map.set(issueNumber, pr);
        }
      }
    }

    return map;
  }
}
