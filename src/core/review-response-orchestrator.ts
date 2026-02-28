import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager } from '../git/worktree.js';
import { CommitManager } from '../git/commit.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager } from './checkpoint.js';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { REVIEW_RESPONSE_PHASES } from './phase-registry.js';
export { REVIEW_RESPONSE_PHASES };
import { Logger } from '../logging/logger.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
import { NotificationManager } from '../notifications/manager.js';
import { isCadreSelfRun } from '../util/cadre-self-run.js';
import { formatPullRequestTitle } from '../util/title-format.js';
import { ReviewDiscoveryService, isSkipResult } from './review-discovery-service.js';
import { RebaseRecoveryService } from './rebase-recovery-service.js';
import { ReviewPlanBuilder } from './review-plan-builder.js';

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
  private readonly discoveryService: ReviewDiscoveryService;
  private readonly rebaseService: RebaseRecoveryService;
  private readonly planBuilder: ReviewPlanBuilder;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager = new NotificationManager(),
  ) {
    this.contextBuilder = new ContextBuilder(config, logger);
    this.cadreDir = config.stateDir;
    this.discoveryService = new ReviewDiscoveryService(config, platform, logger);
    this.rebaseService = new RebaseRecoveryService(worktreeManager, launcher, this.contextBuilder, logger);
    this.planBuilder = new ReviewPlanBuilder(logger);
  }

  /**
   * Process review responses for the given issues (or all issues with open PRs
   * if no issue numbers are provided).
   */
  async run(issueNumbers?: number[]): Promise<ReviewResponseResult> {
    // 1. Discover actionable issues via the discovery service
    const discoveryResults = await this.discoveryService.discoverActionableIssues(issueNumbers);

    const result: ReviewResponseResult = {
      processed: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      issues: [],
    };

    for (const discovery of discoveryResults) {
      if (isSkipResult(discovery)) {
        result.skipped++;
        result.issues.push({
          issueNumber: discovery.issueNumber,
          skipped: true,
          skipReason: discovery.skipReason,
        });
        continue;
      }

      const { issueNumber, pr, activeThreads, actionableComments, actionableReviews } = discovery;

      try {
        // 5. Fetch issue details
        const issue: IssueDetail = await this.platform.getIssue(issueNumber);

        // 6. Provision worktree from the PR's branch
        const worktree = await this.worktreeManager.provisionFromBranch(
          issueNumber,
          pr.headBranch,
        );

        // 7. Prepare progressDir early — needed for both rebase conflict context
        //    and the review-response context written below.
        const progressDir = join(worktree.path, '.cadre', 'issues', String(issueNumber));
        await mkdir(progressDir, { recursive: true });

        // 6b. Rebase onto the latest base branch and resolve any conflicts.
        await this.rebaseService.rebaseAndResolveConflicts(
          issueNumber,
          pr.number,
          worktree.path,
          progressDir,
        );

        // Rebase succeeded — count this issue as actively processed.
        result.processed++;
        const reviewContext = this.contextBuilder.buildForReviewResponse(issue, activeThreads);
        await writeFile(join(progressDir, 'review-response.md'), reviewContext, 'utf-8');

        // 7b. Synthesise an implementation plan from review threads AND regular PR comments.
        await this.planBuilder.writePlan(progressDir, activeThreads, actionableComments, actionableReviews);

        // 8. Set up per-issue checkpoint and run the reduced pipeline (phases 3–5)
        const checkpoint = new CheckpointManager(progressDir, this.logger);
        await checkpoint.load(String(issueNumber));
        // Reset phases 3–5 so they re-execute against the new review-response
        // implementation plan.  Without this, IssueOrchestrator sees them as
        // already completed and skips them entirely.
        await checkpoint.resetPhases([...REVIEW_RESPONSE_PHASES]);
        // Ensure phases 1 and 2 are marked completed so IssueOrchestrator starts
        // at phase 3.  On a fresh worktree the checkpoint has no completed phases,
        // which would cause the orchestrator to fall back to phase 1.
        await checkpoint.completePhase(1, '');
        await checkpoint.completePhase(2, join(progressDir, 'implementation-plan.md'));
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
        );

        const issueResult = await issueOrchestrator.run();

        // 9. Push the branch and update the existing PR body on success
        if (issueResult.success) {
          // Push any new commits made by the implementation phase.
          // Force-push is required here because the rebase above rewrote the
          // branch history relative to the remote.
          const commitManager = new CommitManager(worktree.path, this.config.commits, this.logger);
          try {
            await commitManager.push(true, worktree.branch);
            this.logger.info(
              `Issue #${issueNumber} (PR #${pr.number}): pushed changes to ${worktree.branch}`,
              { issueNumber },
            );
          } catch (pushErr) {
            this.logger.error(
              `Issue #${issueNumber}: push failed: ${pushErr}`,
              { issueNumber },
            );
            throw pushErr;
          }

          // Update the existing PR body with the pr-composer's output
          const prContentPath = join(progressDir, 'pr-content.md');
          try {
            const resultParser = new ResultParser();
            const prContent = await resultParser.parsePRContent(prContentPath);
            const newTitle = prContent.title
              ? formatPullRequestTitle(prContent.title, issue.title, issueNumber)
              : undefined;
            let newBody = prContent.body;
            if (this.config.pullRequest.linkIssue) {
              newBody += `\n\n${this.platform.issueLinkSuffix(issueNumber)}`;
            }
            await this.platform.updatePullRequest(pr.number, {
              ...(newTitle ? { title: newTitle } : {}),
              body: newBody,
            });
            if (isCadreSelfRun(this.config)) {
              await this.platform.ensureLabel('cadre-generated');
              await this.platform.applyLabels(pr.number, ['cadre-generated']);
            }
            this.logger.info(
              `Issue #${issueNumber}: updated PR #${pr.number} description`,
              { issueNumber },
            );
          } catch (updateErr) {
            this.logger.error(
              `Issue #${issueNumber}: failed to update PR #${pr.number}: ${updateErr}`,
              { issueNumber },
            );
            throw updateErr;
          }
        }

        // 11. Optionally post a reply comment when configured and pipeline succeeded
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
}
