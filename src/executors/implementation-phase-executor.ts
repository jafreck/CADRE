import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { AgentSession, SessionReviewSummary } from '../agents/types.js';
import { SessionQueue } from '../execution/task-queue.js';
import { exists } from '../util/fs.js';
import { execShell } from '../util/process.js';

export class ImplementationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 3;
  readonly name = 'Implementation';

  async execute(ctx: PhaseContext): Promise<string> {
    const planPath = join(ctx.io.progressDir, 'implementation-plan.md');
    const sessions = await ctx.services.resultParser.parseImplementationPlan(planPath);
    // Create session queue and restore checkpoint state
    const queue = new SessionQueue(sessions);
    const cpState = ctx.io.checkpoint.getState();
    queue.restoreState(cpState.completedTasks, cpState.blockedTasks);

    const maxParallel = ctx.config.options.maxParallelAgents;

    while (!queue.isComplete()) {
      const readySessions = queue.getReady();
      if (readySessions.length === 0) {
        ctx.services.logger.warn('No ready sessions but queue not complete — possible deadlock', {
          issueNumber: ctx.issue.number,
        });
        break;
      }

      // Select non-overlapping batch
      const batch = SessionQueue.selectNonOverlappingBatch(readySessions, maxParallel);
      ctx.services.logger.info(`Implementation batch: ${batch.map((s) => s.id).join(', ')}`, {
        issueNumber: ctx.issue.number,
        phase: 3,
      });

      // Process batch (sessions can run concurrently if they don't share files)
      const batchPromises = batch.map((session) => this.executeSession(session, queue, ctx));
      await Promise.all(batchPromises);

      await ctx.callbacks.updateProgress();
    }

    const counts = queue.getCounts();
    ctx.services.logger.info(
      `Implementation complete: ${counts.completed}/${counts.total} sessions (${counts.blocked} blocked)`,
      { issueNumber: ctx.issue.number, phase: 3 },
    );

    if (counts.blocked > 0 && counts.completed === 0) {
      throw new Error('All implementation sessions blocked');
    }

    // Whole-PR review: runs once after all sessions complete, before phase 4.
    await this.executeWholePrReview(sessions, ctx);

    return planPath;
  }

  private async executeSession(session: AgentSession, queue: SessionQueue, ctx: PhaseContext): Promise<void> {
    if (ctx.io.checkpoint.isTaskCompleted(session.id)) {
      queue.complete(session.id);
      return;
    }

    queue.start(session.id);
    await ctx.io.checkpoint.startTask(session.id);
    await ctx.io.progressWriter.appendEvent(`Session ${session.id} started: ${session.name}`);

    const maxRetries = ctx.config.options.maxRetriesPerTask;

    const retryResult = await ctx.services.retryExecutor.execute({
      fn: async (attempt) => {
        ctx.callbacks.checkBudget();
        // 1. Write session plan slice
        const sessionPlanPath = join(ctx.io.progressDir, `session-${session.id}.md`);
        const sessionPlanContent = this.buildSessionPlanSlice(session);
        await writeFile(sessionPlanPath, sessionPlanContent, 'utf-8');

        // Collect union of all step files for this session
        const sessionFileSet = new Set<string>();
        for (const step of session.steps) {
          for (const f of step.files) {
            sessionFileSet.add(f);
          }
        }
        const sessionFileList = Array.from(sessionFileSet);

        // 2. Launch code-writer (receives entire session with all steps)
        const writerContextPath = await ctx.services.contextBuilder.buildForCodeWriter(
          ctx.issue.number,
          ctx.worktree.path,
          session,
          sessionPlanPath,
          sessionFileList.map((f) => join(ctx.worktree.path, f)),
          ctx.io.progressDir,
        );

        const writerResult = await ctx.services.launcher.launchAgent(
          {
            agent: 'code-writer',
            issueNumber: ctx.issue.number,
            phase: 3,
            sessionId: session.id,
            contextPath: writerContextPath,
            outputPath: ctx.worktree.path,
          },
          ctx.worktree.path,
        );

        ctx.callbacks.recordTokens('code-writer', writerResult.tokenUsage);
        ctx.callbacks.checkBudget();

        if (!writerResult.success) {
          throw new Error(`Code writer failed: ${writerResult.error}`);
        }

        // 2.5. Per-session build check (optional) — runs once after all steps complete
        if (ctx.config.commands.build && ctx.config.options.perTaskBuildCheck) {
          let buildResult = await execShell(ctx.config.commands.build, {
            cwd: ctx.worktree.path,
            timeout: 300_000,
          });

          for (
            let round = 0;
            round < ctx.config.options.maxBuildFixRounds && buildResult.exitCode !== 0;
            round++
          ) {
            const buildFailurePath = join(ctx.io.progressDir, `build-failure-${session.id}-${round}.txt`);
            await writeFile(buildFailurePath, buildResult.stderr + buildResult.stdout, 'utf-8');
            const buildFixContextPath = await ctx.services.contextBuilder.buildForFixSurgeon(
              ctx.issue.number,
              ctx.worktree.path,
              session.id,
              buildFailurePath,
              sessionFileList.map((f) => join(ctx.worktree.path, f)),
              ctx.io.progressDir,
              'build',
              3,
            );

            const buildFixResult = await ctx.services.launcher.launchAgent(
              {
                agent: 'fix-surgeon',
                issueNumber: ctx.issue.number,
                phase: 3,
                sessionId: session.id,
                contextPath: buildFixContextPath,
                outputPath: ctx.worktree.path,
              },
              ctx.worktree.path,
            );

            ctx.callbacks.recordTokens('fix-surgeon', buildFixResult.tokenUsage);
            ctx.callbacks.checkBudget();

            buildResult = await execShell(ctx.config.commands.build, {
              cwd: ctx.worktree.path,
              timeout: 300_000,
            });
          }

          if (buildResult.exitCode !== 0) {
            throw new Error(`Build failed after ${ctx.config.options.maxBuildFixRounds} fix rounds`);
          }
        }

        // 3. Launch test-writer (once per session, after all steps are done)
        const changedFiles = await ctx.io.commitManager.getChangedFiles();
        if (session.testable === false) {
          ctx.services.logger.info(
            `Skipping test-writer for session ${session.id} (testable: false)`,
            { issueNumber: ctx.issue.number, sessionId: session.id },
          );
        } else {
          const testWriterContextPath = await ctx.services.contextBuilder.buildForTestWriter(
            ctx.issue.number,
            ctx.worktree.path,
            session,
            changedFiles.map((f) => join(ctx.worktree.path, f)),
            sessionPlanPath,
            ctx.io.progressDir,
          );

          const testResult = await ctx.services.launcher.launchAgent(
            {
              agent: 'test-writer',
              issueNumber: ctx.issue.number,
              phase: 3,
              sessionId: session.id,
              contextPath: testWriterContextPath,
              outputPath: ctx.worktree.path,
            },
            ctx.worktree.path,
          );

          ctx.callbacks.recordTokens('test-writer', testResult.tokenUsage);
          ctx.callbacks.checkBudget();
        }

        // 4. Commit code-writer + test-writer output so getTaskDiff() reflects this session's changes
        await ctx.io.commitManager.commit(
          `wip: ${session.name} (attempt ${attempt})`,
          ctx.issue.number,
          'feat',
        );

        // 5. Launch code-reviewer
        const diffPath = join(ctx.io.progressDir, `diff-${session.id}.patch`);
        const rawDiff = await ctx.io.commitManager.getTaskDiff();
        const diff = truncateDiff(rawDiff, 200_000);
        await writeFile(diffPath, diff, 'utf-8');

        const reviewerContextPath = await ctx.services.contextBuilder.buildForCodeReviewer(
          ctx.issue.number,
          ctx.worktree.path,
          session,
          diffPath,
          sessionPlanPath,
          ctx.io.progressDir,
        );

        const reviewResult = await ctx.services.launcher.launchAgent(
          {
            agent: 'code-reviewer',
            issueNumber: ctx.issue.number,
            phase: 3,
            sessionId: session.id,
            contextPath: reviewerContextPath,
            outputPath: join(ctx.io.progressDir, `review-${session.id}.md`),
          },
          ctx.worktree.path,
        );

        ctx.callbacks.recordTokens('code-reviewer', reviewResult.tokenUsage);
        ctx.callbacks.checkBudget();

        // 6. Check review verdict
        if (reviewResult.success) {
          const reviewPath = join(ctx.io.progressDir, `review-${session.id}.md`);
          if (await exists(reviewPath)) {
            let review;
            try {
              review = await ctx.services.resultParser.parseReview(reviewPath);
            } catch (err) {
              if (err instanceof ZodError) {
                const msg = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
                ctx.services.logger.warn(`Review validation failed (will retry): ${msg}`, {
                  issueNumber: ctx.issue.number,
                  sessionId: session.id,
                });
              }
              throw err;
            }
            // Write per-session summary JSON for later use by whole-PR reviewer (non-fatal)
            try {
              const summaryPath = join(ctx.io.progressDir, `review-${session.id}-summary.json`);
              const summaryData: SessionReviewSummary = {
                sessionId: session.id,
                verdict: review.verdict,
                summary: review.summary ?? '',
                keyFindings: (review.issues ?? []).map((i) => i.description),
              };
              await writeFile(summaryPath, JSON.stringify(summaryData, null, 2), 'utf-8');
            } catch (err) {
              // Non-fatal: summary write failure should not block session completion
              const msg = err instanceof Error ? err.message : String(err);
              ctx.services.logger.warn(`Failed to write per-session review summary for ${session.id}: ${msg}`, {
                sessionId: session.id,
              });
            }
            if (review.verdict === 'needs-fixes') {
              // Launch fix-surgeon
              const fixContextPath = await ctx.services.contextBuilder.buildForFixSurgeon(
                ctx.issue.number,
                ctx.worktree.path,
                session.id,
                reviewPath,
                changedFiles.map((f) => join(ctx.worktree.path, f)),
                ctx.io.progressDir,
                'review',
                3,
              );

              const fixResult = await ctx.services.launcher.launchAgent(
                {
                  agent: 'fix-surgeon',
                  issueNumber: ctx.issue.number,
                  phase: 3,
                  sessionId: session.id,
                  contextPath: fixContextPath,
                  outputPath: ctx.worktree.path,
                },
                ctx.worktree.path,
              );

              ctx.callbacks.recordTokens('fix-surgeon', fixResult.tokenUsage);
              ctx.callbacks.checkBudget();

              if (!fixResult.success) {
                throw new Error(`Fix surgeon failed: ${fixResult.error}`);
              }
            }
          }
        }

        return true;
      },
      maxAttempts: maxRetries,
      description: `Session ${session.id}: ${session.name}`,
    });

    ctx.callbacks.checkBudget();

    if (retryResult.success) {
      queue.complete(session.id);
      await ctx.io.checkpoint.completeTask(session.id);
      await ctx.io.progressWriter.appendEvent(`Session ${session.id} completed`);

      // Commit session
      await ctx.io.commitManager.commit(
        `implement ${session.name}`,
        ctx.issue.number,
        'feat',
      );
    } else {
      queue.markBlocked(session.id);
      await ctx.io.checkpoint.blockTask(session.id);
      await ctx.io.progressWriter.appendEvent(`Session ${session.id} blocked: ${retryResult.error}`);
    }
  }

  private async executeWholePrReview(sessions: AgentSession[], ctx: PhaseContext): Promise<void> {
    ctx.services.logger.info('[Whole-PR review] Starting post-implementation review', {
      issueNumber: ctx.issue.number,
      phase: 3,
    });

    // Build full PR diff against base commit (no truncation — full diff referenced by path).
    const rawDiff = await ctx.io.commitManager.getDiff(ctx.worktree.baseCommit);
    const diffPath = join(ctx.io.progressDir, 'whole-pr-diff.patch');
    await writeFile(diffPath, rawDiff, 'utf-8');

    // Collect all session plan file paths and per-session review summaries.
    const sessionPlanPaths: string[] = [];
    const sessionSummaries: SessionReviewSummary[] = [];
    for (const session of sessions) {
      const planPath = join(ctx.io.progressDir, `session-${session.id}.md`);
      if (await exists(planPath)) {
        sessionPlanPaths.push(planPath);
      }
      const summaryPath = join(ctx.io.progressDir, `review-${session.id}-summary.json`);
      try {
        const raw = await readFile(summaryPath, 'utf-8');
        const parsed = JSON.parse(raw) as SessionReviewSummary;
        sessionSummaries.push(parsed);
      } catch {
        // No summary for this session — omit from array
      }
    }

    const maxRetries = ctx.config.options.maxWholePrReviewRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      ctx.callbacks.checkBudget();

      const reviewerContextPath = await ctx.services.contextBuilder.buildForWholePrCodeReviewer(
        ctx.issue.number,
        ctx.worktree.path,
        diffPath,
        sessionPlanPaths,
        ctx.io.progressDir,
        sessionSummaries,
      );

      const reviewResult = await ctx.services.launcher.launchAgent(
        {
          agent: 'whole-pr-reviewer',
          issueNumber: ctx.issue.number,
          phase: 3,
          contextPath: reviewerContextPath,
          outputPath: join(ctx.io.progressDir, 'whole-pr-review.md'),
        },
        ctx.worktree.path,
      );

      ctx.callbacks.recordTokens('whole-pr-reviewer', reviewResult.tokenUsage);
      ctx.callbacks.checkBudget();

      if (!reviewResult.success) {
        ctx.services.logger.warn('[Whole-PR review] Reviewer agent did not succeed; skipping', {
          issueNumber: ctx.issue.number,
          phase: 3,
        });
        return;
      }

      const reviewPath = join(ctx.io.progressDir, 'whole-pr-review.md');
      if (!(await exists(reviewPath))) {
        ctx.services.logger.warn('[Whole-PR review] No output file produced; skipping', {
          issueNumber: ctx.issue.number,
          phase: 3,
        });
        return;
      }

      let review;
      try {
        review = await ctx.services.resultParser.parseReview(reviewPath);
      } catch (err) {
        ctx.services.logger.warn(
          `[Whole-PR review] Failed to parse review output: ${(err as Error).message}`,
          { issueNumber: ctx.issue.number, phase: 3 },
        );
        return;
      }

      if (review.verdict !== 'needs-fixes') {
        ctx.services.logger.info('[Whole-PR review] Verdict: pass', {
          issueNumber: ctx.issue.number,
          phase: 3,
        });
        return;
      }

      ctx.services.logger.info(
        `[Whole-PR review] Verdict: needs-fixes (attempt ${attempt + 1}/${maxRetries + 1})`,
        { issueNumber: ctx.issue.number, phase: 3 },
      );

      if (attempt >= maxRetries) {
        ctx.services.logger.warn(
          `[Whole-PR review] Max retries (${maxRetries}) exceeded; continuing to phase 4`,
          { issueNumber: ctx.issue.number, phase: 3 },
        );
        return;
      }

      // Launch fix-surgeon to address findings.
      const changedFiles = await ctx.io.commitManager.getChangedFiles();
      const fixContextPath = await ctx.services.contextBuilder.buildForFixSurgeon(
        ctx.issue.number,
        ctx.worktree.path,
        'whole-pr',
        reviewPath,
        changedFiles.map((f) => join(ctx.worktree.path, f)),
        ctx.io.progressDir,
        'review',
        3,
      );

      const fixResult = await ctx.services.launcher.launchAgent(
        {
          agent: 'fix-surgeon',
          issueNumber: ctx.issue.number,
          phase: 3,
          sessionId: 'whole-pr',
          contextPath: fixContextPath,
          outputPath: ctx.worktree.path,
        },
        ctx.worktree.path,
      );

      ctx.callbacks.recordTokens('fix-surgeon', fixResult.tokenUsage);
      ctx.callbacks.checkBudget();

      if (!fixResult.success) {
        ctx.services.logger.warn('[Whole-PR review] Fix surgeon failed; aborting review loop', {
          issueNumber: ctx.issue.number,
          phase: 3,
        });
        return;
      }

      // Commit fix-surgeon output and exit — one successful fix round is sufficient.
      await ctx.io.commitManager.commit(
        `fix: whole-PR review fixes (round ${attempt + 1})`,
        ctx.issue.number,
        'fix',
      );

      ctx.services.logger.info('[Whole-PR review] Fix applied successfully; continuing to phase 4', {
        issueNumber: ctx.issue.number,
        phase: 3,
      });
      return;
    }
  }

  private buildSessionPlanSlice(session: AgentSession): string {
    const lines = [
      `# Session: ${session.id} - ${session.name}`,
      '',
      `**Rationale:** ${session.rationale}`,
      `**Dependencies:** ${session.dependencies.length === 0 ? 'none' : session.dependencies.join(', ')}`,
      '',
      `## Steps`,
    ];

    for (const step of session.steps) {
      lines.push('');
      lines.push(`### ${step.id}: ${step.name}`);
      lines.push(`**Description:** ${step.description}`);
      lines.push(`**Files:** ${step.files.join(', ')}`);
      lines.push(`**Complexity:** ${step.complexity}`);
      lines.push(`**Acceptance Criteria:**`);
      for (const c of step.acceptanceCriteria) {
        lines.push(`- ${c}`);
      }
    }

    return lines.join('\n');
  }
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return diff.slice(0, maxChars) + '\n\n[Diff truncated: exceeded 200,000 character limit]\n';
}
