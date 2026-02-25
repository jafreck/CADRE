import type { CadreConfig } from '../config/schema.js';
import { IssueFetcher, type IssueDetail } from './issues.js';
import { Logger } from '../logging/logger.js';

/**
 * Resolves issue queries into concrete issue lists.
 * Handles both explicit IDs and query-based resolution.
 */
export class IssueQueryResolver {
  private readonly fetcher: IssueFetcher;

  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {
    this.fetcher = new IssueFetcher(config.repository, logger);
  }

  /**
   * Resolve all issues from the config.
   * Filters out closed issues (unless config says to include them).
   * Deduplicates by issue number.
   */
  async resolve(): Promise<IssueDetail[]> {
    const issues = await this.fetcher.resolveIssues(this.config);

    // Deduplicate
    const seen = new Set<number>();
    const unique = issues.filter((issue) => {
      if (seen.has(issue.number)) return false;
      seen.add(issue.number);
      return true;
    });

    this.logger.info(`Resolved ${unique.length} unique issues`, {
      data: { issueNumbers: unique.map((i) => i.number) },
    });

    return unique;
  }

  /**
   * Resolve a single issue by number.
   */
  async resolveOne(issueNumber: number): Promise<IssueDetail> {
    return this.fetcher.fetchIssue(issueNumber);
  }
}
