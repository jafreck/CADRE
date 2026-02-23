import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { ImplementationTask } from '../agents/types.js';
import { TaskQueue } from '../execution/task-queue.js';
import { exists } from '../util/fs.js';
import { execShell } from '../util/process.js';

export class ImplementationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 3;
  readonly name = 'Implementation';

  async execute(ctx: PhaseContext): Promise<string> {
    const planPath = join(ctx.io.progressDir, 'implementation-plan.md');
    const tasks = await ctx.services.resultParser.parseImplementationPlan(planPath);

    // Create task queue and restore checkpoint state
    const queue = new TaskQueue(tasks);
    const cpState = ctx.io.checkpoint.getState();
    queue.restoreState(cpState.completedTasks, cpState.blockedTasks);

    const maxParallel = ctx.config.options.maxParallelAgents;

    while (!queue.isComplete()) {
      const readyTasks = queue.getReady();
      if (readyTasks.length === 0) {
        ctx.services.logger.warn('No ready tasks but queue not complete — possible deadlock', {
          issueNumber: ctx.issue.number,
        });
        break;
      }

      // Select non-overlapping batch
      const batch = TaskQueue.selectNonOverlappingBatch(readyTasks, maxParallel);
      ctx.services.logger.info(`Implementation batch: ${batch.map((t) => t.id).join(', ')}`, {
        issueNumber: ctx.issue.number,
        phase: 3,
      });

      // Process batch (tasks can run concurrently if they don't share files)
      const batchPromises = batch.map((task) => this.executeTask(task, queue, ctx));
      await Promise.all(batchPromises);

      await ctx.callbacks.updateProgress();
    }

    const counts = queue.getCounts();
    ctx.services.logger.info(
      `Implementation complete: ${counts.completed}/${counts.total} tasks (${counts.blocked} blocked)`,
      { issueNumber: ctx.issue.number, phase: 3 },
    );

    if (counts.blocked > 0 && counts.completed === 0) {
      throw new Error('All implementation tasks blocked');
    }

    return planPath;
  }

  private async executeTask(task: ImplementationTask, queue: TaskQueue, ctx: PhaseContext): Promise<void> {
    if (ctx.io.checkpoint.isTaskCompleted(task.id)) {
      queue.complete(task.id);
      return;
    }

    queue.start(task.id);
    await ctx.io.checkpoint.startTask(task.id);
    await ctx.io.progressWriter.appendEvent(`Task ${task.id} started: ${task.name}`);

    const maxRetries = ctx.config.options.maxRetriesPerTask;

    const retryResult = await ctx.services.retryExecutor.execute({
      fn: async (attempt) => {
        ctx.callbacks.checkBudget();
        // 1. Write task plan slice
        const taskPlanPath = join(ctx.io.progressDir, `task-${task.id}.md`);
        const taskPlanContent = this.buildTaskPlanSlice(task);
        await writeFile(taskPlanPath, taskPlanContent, 'utf-8');

        // 2. Launch code-writer
        const writerContextPath = await ctx.services.contextBuilder.buildForCodeWriter(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          taskPlanPath,
          task.files.map((f) => join(ctx.worktree.path, f)),
          ctx.io.progressDir,
        );

        const writerResult = await ctx.services.launcher.launchAgent(
          {
            agent: 'code-writer',
            issueNumber: ctx.issue.number,
            phase: 3,
            taskId: task.id,
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

        // 2.5. Per-task build check (optional)
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
            const buildFailurePath = join(ctx.io.progressDir, `build-failure-${task.id}-${round}.txt`);
            await writeFile(buildFailurePath, buildResult.stderr + buildResult.stdout, 'utf-8');

            const buildFixContextPath = await ctx.services.contextBuilder.buildForFixSurgeon(
              ctx.issue.number,
              ctx.worktree.path,
              task.id,
              buildFailurePath,
              task.files.map((f) => join(ctx.worktree.path, f)),
              ctx.io.progressDir,
              'build',
              3,
            );

            const buildFixResult = await ctx.services.launcher.launchAgent(
              {
                agent: 'fix-surgeon',
                issueNumber: ctx.issue.number,
                phase: 3,
                taskId: task.id,
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

        // 3. Launch test-writer
        const changedFiles = await ctx.io.commitManager.getChangedFiles();
        const testWriterContextPath = await ctx.services.contextBuilder.buildForTestWriter(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          changedFiles.map((f) => join(ctx.worktree.path, f)),
          taskPlanPath,
          ctx.io.progressDir,
        );

        const testResult = await ctx.services.launcher.launchAgent(
          {
            agent: 'test-writer',
            issueNumber: ctx.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: testWriterContextPath,
            outputPath: ctx.worktree.path,
          },
          ctx.worktree.path,
        );

        ctx.callbacks.recordTokens('test-writer', testResult.tokenUsage);
        ctx.callbacks.checkBudget();

        // 4. Commit code-writer + test-writer output so getTaskDiff() reflects this task's changes
        await ctx.io.commitManager.commit(
          `wip: ${task.name} (attempt ${attempt})`,
          ctx.issue.number,
          'feat',
        );

        // 5. Launch code-reviewer
        const diffPath = join(ctx.io.progressDir, `diff-${task.id}.patch`);
        const rawDiff = await ctx.io.commitManager.getTaskDiff();
        const diff = truncateDiff(rawDiff, 200_000);
        await writeFile(diffPath, diff, 'utf-8');

        const reviewerContextPath = await ctx.services.contextBuilder.buildForCodeReviewer(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          diffPath,
          taskPlanPath,
          ctx.io.progressDir,
        );

        const reviewResult = await ctx.services.launcher.launchAgent(
          {
            agent: 'code-reviewer',
            issueNumber: ctx.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: reviewerContextPath,
            outputPath: join(ctx.io.progressDir, `review-${task.id}.md`),
          },
          ctx.worktree.path,
        );

        ctx.callbacks.recordTokens('code-reviewer', reviewResult.tokenUsage);
        ctx.callbacks.checkBudget();

        // 6. Check review verdict
        if (reviewResult.success) {
          const reviewPath = join(ctx.io.progressDir, `review-${task.id}.md`);
          if (await exists(reviewPath)) {
            let review;
            try {
              review = await ctx.services.resultParser.parseReview(reviewPath);
            } catch (err) {
              if (err instanceof ZodError) {
                const msg = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
                ctx.services.logger.warn(`Review validation failed (will retry): ${msg}`, {
                  issueNumber: ctx.issue.number,
                  taskId: task.id,
                });
              }
              throw err;
            }
            if (review.verdict === 'needs-fixes') {
              // Launch fix-surgeon
              const fixContextPath = await ctx.services.contextBuilder.buildForFixSurgeon(
                ctx.issue.number,
                ctx.worktree.path,
                task.id,
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
                  taskId: task.id,
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
      description: `Task ${task.id}: ${task.name}`,
    });

    ctx.callbacks.checkBudget();

    if (retryResult.success) {
      queue.complete(task.id);
      await ctx.io.checkpoint.completeTask(task.id);
      await ctx.io.progressWriter.appendEvent(`Task ${task.id} completed`);

      // Commit task
      await ctx.io.commitManager.commit(
        `implement ${task.name}`,
        ctx.issue.number,
        'feat',
      );
    } else {
      queue.markBlocked(task.id);
      await ctx.io.checkpoint.blockTask(task.id);
      await ctx.io.progressWriter.appendEvent(`Task ${task.id} blocked: ${retryResult.error}`);
    }
  }

  private buildTaskPlanSlice(task: ImplementationTask): string {
    return [
      `# Task: ${task.id} - ${task.name}`,
      '',
      `**Description:** ${task.description}`,
      `**Files:** ${task.files.join(', ')}`,
      `**Dependencies:** ${task.dependencies.length === 0 ? 'none' : task.dependencies.join(', ')}`,
      `**Complexity:** ${task.complexity}`,
      `**Acceptance Criteria:**`,
      ...task.acceptanceCriteria.map((c) => `- ${c}`),
    ].join('\n');
  }


}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return diff.slice(0, maxChars) + '\n\n[Diff truncated: exceeded 200,000 character limit]\n';
}
