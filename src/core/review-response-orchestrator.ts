import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager } from './checkpoint.js';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { Logger } from '../logging/logger.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { NotificationManager } from '../notifications/manager.js';

/** The phases executed during a review-response cycle (skips analysis & planning). */
export const REVIEW_RESPONSE_PHASES = [3, 4, 5];

export interface ReviewResponseIssueOutcome {
  issueNumber: number;
  skipped: boolean;
  skipReason?: string;
  result?: IssueResult;
}

export interface ReviewResponseResult {
  /** Total issues considered for processing (not skipped). */
  processed: number;
  /** Issues skipped (no open PR or no unresolved threads). */
  skipped: number;
  /** Issues where the pipeline completed successfully. */
  succeeded: number;
  /** Issues where the pipeline failed. */
  failed: number;
  /** Per-issue outcomes. */
  issues: ReviewResponseIssueOutcome[];
}

/**
 * Runs a reduced (phases 3–5) pipeline for issues that have open PRs with
 * unresolved review threads, allowing CADRE to address reviewer feedback.
 */
export class ReviewResponseOrchestrator {
  private readonly contextBuilder: ContextBuilder;
  private readonly cadreDir: string;

  constructor(
    private readonly config: CadreConfig,
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager = new NotificationManager(),
  ) {
    this.contextBuilder = new ContextBuilder(config, logger);
    this.cadreDir = join(config.repoPath, '.cadre');
  }

  /**
   * Process review responses for the given issues (or all issues with open PRs
   * if no issue numbers are provided).
   */
  async run(issueNumbers?: number[]): Promise<ReviewResponseResult> {
    // 1. List open PRs and build issue → PR mapping
    const openPRs = await this.platform.listPullRequests({ state: 'open' });
    const issueToPR = this.mapIssuesToPRs(openPRs);

    // 2. Determine which issues to consider
    const issuesToConsider =
      issueNumbers != null
        ? issueNumbers
        : Array.from(issueToPR.keys());

    const result: ReviewResponseResult = {
      processed: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      issues: [],
    };

    for (const issueNumber of issuesToConsider) {
      // 3. Skip issues with no open PR
      const pr = issueToPR.get(issueNumber);
      if (!pr) {
        this.logger.info(
          `Issue #${issueNumber}: no open PR found, skipping`,
          { issueNumber },
        );
        result.skipped++;
        result.issues.push({ issueNumber, skipped: true, skipReason: 'no open PR' });
        continue;
      }

      // 4. Get review threads and filter to active (unresolved, non-outdated)
      const threads = await this.platform.listPRReviewComments(pr.number);
      const activeThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);

      if (activeThreads.length === 0) {
        this.logger.info(
          `Issue #${issueNumber} (PR #${pr.number}): all review threads resolved or outdated, skipping`,
          { issueNumber },
        );
        result.skipped++;
        result.issues.push({
          issueNumber,
          skipped: true,
          skipReason: 'no unresolved review threads',
        });
        continue;
      }

      result.processed++;

      try {
        // 5. Fetch issue details
        const issue: IssueDetail = await this.platform.getIssue(issueNumber);

        // 6. Provision worktree from the PR's branch
        const worktree = await this.worktreeManager.provisionFromBranch(
          issueNumber,
          pr.headBranch,
        );

        // 7. Build and persist review-response context so phase agents can read it
        const progressDir = join(worktree.path, '.cadre', 'issues', String(issueNumber));
        await mkdir(progressDir, { recursive: true });
        const reviewContext = this.contextBuilder.buildForReviewResponse(issue, activeThreads);
        await writeFile(join(progressDir, 'review-response.md'), reviewContext, 'utf-8');

        // 8. Set up per-issue checkpoint and run the reduced pipeline (phases 3–5)
        const checkpoint = new CheckpointManager(progressDir, this.logger);
        await checkpoint.load(String(issueNumber));
        await checkpoint.setWorktreeInfo(worktree.path, worktree.branch, worktree.baseCommit);

        const issueOrchestrator = new IssueOrchestrator(
          this.config,
          issue,
          worktree,
          checkpoint,
          this.launcher,
          this.platform,
          this.logger.child(issueNumber, join(this.cadreDir, 'logs')),
          this.notifications,
          REVIEW_RESPONSE_PHASES,
        );

        const issueResult = await issueOrchestrator.run();

        // 9. Optionally post a reply comment when configured and pipeline succeeded
        if (this.config.reviewResponse.autoReplyOnResolved && issueResult.success) {
          await this.platform.addIssueComment(
            issueNumber,
            `Review feedback addressed in PR #${pr.number}. Implementation phases completed successfully.`,
          );
        }

        if (issueResult.success) {
          result.succeeded++;
        } else {
          result.failed++;
        }
        result.issues.push({ issueNumber, skipped: false, result: issueResult });
      } catch (err) {
        this.logger.error(
          `Issue #${issueNumber}: review response pipeline failed: ${err}`,
          { issueNumber },
        );
        result.failed++;
        result.issues.push({ issueNumber, skipped: false });
      }
    }

    return result;
  }

  /**
   * Build a map of issue number → PullRequestInfo by extracting the issue
   * number from each PR's head branch using the configured branch template.
   */
  private mapIssuesToPRs(prs: PullRequestInfo[]): Map<number, PullRequestInfo> {
    const map = new Map<number, PullRequestInfo>();

    // Convert the branch template into a regex, preserving {issue}/{title} as capture groups.
    const ISSUE_TOKEN = '\x00ISSUE\x00';
    const TITLE_TOKEN = '\x00TITLE\x00';
    const regexStr = this.config.branchTemplate
      .replace(/\{issue\}/g, ISSUE_TOKEN)
      .replace(/\{title\}/g, TITLE_TOKEN)
      .replace(/[-[\]^$.*+?(){}|\\]/g, '\\$&') // escape remaining regex metacharacters
      .replace(ISSUE_TOKEN, '(\\d+)')
      .replace(TITLE_TOKEN, '[^/]+');
    const branchRegex = new RegExp(`^${regexStr}$`);

    for (const pr of prs) {
      const match = pr.headBranch.match(branchRegex);
      if (match) {
        const issueNumber = parseInt(match[1], 10);
        // Keep the first PR found per issue number (most recently active)
        if (!map.has(issueNumber)) {
          map.set(issueNumber, pr);
        }
      }
    }

    return map;
  }
}
