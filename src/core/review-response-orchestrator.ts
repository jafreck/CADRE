import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager } from '../git/worktree.js';
import { CommitManager } from '../git/commit.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager } from './checkpoint.js';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { Logger } from '../logging/logger.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
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

        // 6b. Rebase onto the latest base branch so the PR is in a clean,
        //     conflict-free state before agents make further changes.
        //     If conflicts arise, the conflict-resolver agent is invoked to
        //     resolve them in place; then the rebase is continued.  Any
        //     failure during this sequence aborts the rebase and throws so
        //     the issue lands in result.failed.
        const rebaseStartResult = await this.worktreeManager.rebaseStart(issueNumber);

        if (rebaseStartResult.status === 'conflict') {
          if (rebaseStartResult.conflictedFiles.length === 0) {
            // Rebase is paused but all conflict markers are already resolved
            // (e.g. a previous run's conflict-resolver cleared them).  Skip
            // the agent and go straight to rebase --continue.
            this.logger.info(
              `Rebase paused for PR #${pr.number} with 0 conflicted files — continuing rebase without conflict-resolver`,
              { issueNumber },
            );
          } else {
            this.logger.info(
              `Merge conflicts detected for PR #${pr.number}; launching conflict-resolver agent`,
              { issueNumber, data: { conflictedFiles: rebaseStartResult.conflictedFiles } },
            );

            // Build context for the conflict-resolver agent.
            const conflictContextPath = await this.contextBuilder.buildForConflictResolver(
              issueNumber,
              worktree.path,
              rebaseStartResult.conflictedFiles,
              progressDir,
            );

            // Launch the agent; it writes resolved file content directly to disk.
            const resolverResult = await this.launcher.launchAgent(
              {
                agent: 'conflict-resolver',
                issueNumber,
                phase: 0,
                contextPath: conflictContextPath,
                outputPath: join(progressDir, 'conflict-resolution-report.md'),
              },
              worktree.path,
            );

            if (!resolverResult.success) {
              // Build a human-readable detail string for the log and thrown error
              // so timeouts are clearly distinguishable from non-zero exit codes.
              const detail = resolverResult.timedOut
                ? `timed out after ${resolverResult.duration}ms`
                : `exit ${resolverResult.exitCode}`;
              this.logger.error(
                `Conflict-resolver agent failed for PR #${pr.number} (${detail})`,
                {
                  issueNumber,
                  data: {
                    timedOut: resolverResult.timedOut,
                    exitCode: resolverResult.exitCode,
                    stderr: resolverResult.stderr?.slice(-500) ?? '',
                  },
                },
              );
              await this.worktreeManager.rebaseAbort(issueNumber);
              throw new Error(`Conflict-resolver agent failed for PR #${pr.number} (${detail})`);
            }

            // Agent exited 0 but may not have written its resolution report.
            // This happens when the process is killed mid-turn (e.g. timeout fires
            // after conflict markers are cleared but before the report is written),
            // or when the agent crashes without producing output.  Without this guard
            // a successful-looking exit would allow rebaseContinue to run on files
            // that may still contain unresolved markers.
            if (!resolverResult.outputExists) {
              this.logger.error(
                `Conflict-resolver agent for PR #${pr.number} exited successfully but produced no output at ${resolverResult.outputPath}`,
                {
                  issueNumber,
                  data: {
                    outputPath: resolverResult.outputPath,
                    stderr: resolverResult.stderr?.slice(-300) ?? '',
                  },
                },
              );
              await this.worktreeManager.rebaseAbort(issueNumber);
              throw new Error(
                `Conflict-resolver agent produced no output for PR #${pr.number} — resolution report missing at ${resolverResult.outputPath}`,
              );
            }
          } // end else (conflictedFiles.length > 0)

          // Stage all resolved files and finish the rebase.
          const continueResult = await this.worktreeManager.rebaseContinue(issueNumber);
          if (!continueResult.success) {
            // rebaseContinue already logs which files still have markers at the git
            // layer; log here as well so the orchestrator's issue-level log captures
            // the full context (including which files are still conflicted).
            this.logger.error(
              `Rebase --continue failed for PR #${pr.number}: ${continueResult.error ?? 'unknown error'}`,
              { issueNumber, data: { conflictedFiles: continueResult.conflictedFiles } },
            );
            await this.worktreeManager.rebaseAbort(issueNumber);
            throw new Error(
              `Rebase --continue failed after conflict resolution for PR #${pr.number}: ${continueResult.error ?? 'unknown error'}`,
            );
          }
        }

        // Rebase succeeded — count this issue as actively processed.
        result.processed++;
        const reviewContext = this.contextBuilder.buildForReviewResponse(issue, activeThreads);
        await writeFile(join(progressDir, 'review-response.md'), reviewContext, 'utf-8');

        // 7b. Synthesise an implementation plan from the review threads so that
        //     Phase 3 (ImplementationPhaseExecutor) has the tasks it expects.
        const planTasks = activeThreads.map((thread, idx) => {
          const files = [...new Set(thread.comments.map((c) => c.path).filter(Boolean))];
          const description = thread.comments.map((c) => c.body).join('\n\n');
          return {
            id: `task-${String(idx + 1).padStart(3, '0')}`,
            name: `Address review comment${files.length ? ` in ${files[0]}` : ''}`,
            description,
            files: files.length ? files : [],
            dependencies: [] as string[],
            complexity: 'simple' as const,
            acceptanceCriteria: [
              'Review comment addressed as described',
              'Existing tests continue to pass',
            ],
          };
        });
        const planContent = [
          '# Review-Response Implementation Plan',
          '',
          '```cadre-json',
          JSON.stringify(planTasks, null, 2),
          '```',
        ].join('\n');
        await writeFile(join(progressDir, 'implementation-plan.md'), planContent, 'utf-8');

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
            const resultParser = new ResultParser(this.logger);
            const prContent = await resultParser.parsePRContent(prContentPath);
            const newTitle = prContent.title
              ? `${prContent.title} (#${issueNumber})`
              : undefined;
            let newBody = prContent.body;
            if (this.config.pullRequest.linkIssue) {
              newBody += `\n\n${this.platform.issueLinkSuffix(issueNumber)}`;
            }
            await this.platform.updatePullRequest(pr.number, {
              ...(newTitle ? { title: newTitle } : {}),
              body: newBody,
            });
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
