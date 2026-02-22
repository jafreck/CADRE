import { GitHubAPI } from '../github/api.js';
import type { CadreConfig } from '../config/schema.js';
import { Logger } from '../logging/logger.js';

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  headBranch: string;
  baseBranch: string;
}

/**
 * Creates pull requests using the GitHub MCP server via GitHubAPI.
 */
export class PullRequestCreator {
  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
    private readonly api: GitHubAPI,
  ) {}

  /**
   * Create a pull request for a completed issue.
   */
  async create(
    issueNumber: number,
    issueTitle: string,
    branchName: string,
    body: string,
    _worktreePath: string,
  ): Promise<PullRequestInfo> {
    const prConfig = this.config.pullRequest;

    // Build PR title
    const title = `${issueTitle} (#${issueNumber})`;

    // Add "Closes #N" to body if configured
    let fullBody = body;
    if (prConfig.linkIssue) {
      fullBody += `\n\nCloses #${issueNumber}`;
    }

    const result = await this.api.createPullRequest({
      title,
      body: fullBody,
      head: branchName,
      base: this.config.baseBranch,
      draft: prConfig.draft,
    });

    const prNumber = result.number as number;
    const prUrl = (result.html_url as string) ?? (result.url as string) ?? '';

    this.logger.info(`Created PR #${prNumber}: ${prUrl}`, {
      issueNumber,
      data: { prNumber, prUrl, title },
    });

    return {
      number: prNumber,
      url: prUrl,
      title,
      headBranch: branchName,
      baseBranch: this.config.baseBranch,
    };
  }

  /**
   * Check if a PR already exists for this branch.
   */
  async exists(branchName: string): Promise<PullRequestInfo | null> {
    try {
      const prs = await this.api.listPullRequests({
        head: branchName,
        state: 'open',
      });

      if (!prs || prs.length === 0) {
        return null;
      }

      const pr = prs[0];
      return {
        number: pr.number as number,
        url: (pr.html_url as string) ?? (pr.url as string) ?? '',
        title: pr.title as string,
        headBranch: (pr.head as Record<string, unknown>)?.ref as string ?? branchName,
        baseBranch: (pr.base as Record<string, unknown>)?.ref as string ?? this.config.baseBranch,
      };
    } catch {
      return null;
    }
  }

  /**
   * Update an existing PR body/title.
   */
  async update(
    prNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    try {
      await this.api.updatePullRequest(prNumber, updates);
    } catch (err) {
      this.logger.warn(`Failed to update PR #${prNumber}: ${err}`);
    }
  }
}
