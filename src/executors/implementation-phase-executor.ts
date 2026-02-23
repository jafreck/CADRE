import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { ImplementationTask } from '../agents/types.js';
import { TaskQueue } from '../execution/task-queue.js';
import { exists } from '../util/fs.js';

export class ImplementationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 3;
  readonly name = 'Implementation';

  async execute(ctx: PhaseContext): Promise<string> {
    const planPath = join(ctx.progressDir, 'implementation-plan.md');
    const tasks = await ctx.resultParser.parseImplementationPlan(planPath);

    // Create task queue and restore checkpoint state
    const queue = new TaskQueue(tasks);
    const cpState = ctx.checkpoint.getState();
    queue.restoreState(cpState.completedTasks, cpState.blockedTasks);

    const maxParallel = ctx.config.options.maxParallelAgents;

    while (!queue.isComplete()) {
      const readyTasks = queue.getReady();
      if (readyTasks.length === 0) {
        ctx.logger.warn('No ready tasks but queue not complete — possible deadlock', {
          issueNumber: ctx.issue.number,
        });
        break;
      }

      // Select non-overlapping batch
      const batch = TaskQueue.selectNonOverlappingBatch(readyTasks, maxParallel);
      ctx.logger.info(`Implementation batch: ${batch.map((t) => t.id).join(', ')}`, {
        issueNumber: ctx.issue.number,
        phase: 3,
      });

      // Process batch (tasks can run concurrently if they don't share files)
      const batchPromises = batch.map((task) => this.executeTask(task, queue, ctx));
      await Promise.all(batchPromises);

      await this.updateProgress(ctx);
    }

    const counts = queue.getCounts();
    ctx.logger.info(
      `Implementation complete: ${counts.completed}/${counts.total} tasks (${counts.blocked} blocked)`,
      { issueNumber: ctx.issue.number, phase: 3 },
    );

    if (counts.blocked > 0 && counts.completed === 0) {
      throw new Error('All implementation tasks blocked');
    }

    return planPath;
  }

  private async executeTask(task: ImplementationTask, queue: TaskQueue, ctx: PhaseContext): Promise<void> {
    if (ctx.checkpoint.isTaskCompleted(task.id)) {
      queue.complete(task.id);
      return;
    }

    queue.start(task.id);
    await ctx.checkpoint.startTask(task.id);
    await ctx.progressWriter.appendEvent(`Task ${task.id} started: ${task.name}`);

    const maxRetries = ctx.config.options.maxRetriesPerTask;

    const retryResult = await ctx.retryExecutor.execute({
      fn: async (attempt) => {
        ctx.checkBudget();
        // 1. Write task plan slice
        const taskPlanPath = join(ctx.progressDir, `task-${task.id}.md`);
        const taskPlanContent = this.buildTaskPlanSlice(task);
        await writeFile(taskPlanPath, taskPlanContent, 'utf-8');

        // 2. Launch code-writer
        const writerContextPath = await ctx.contextBuilder.buildForCodeWriter(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          taskPlanPath,
          task.files.map((f) => join(ctx.worktree.path, f)),
          ctx.progressDir,
        );

        const writerResult = await ctx.launcher.launchAgent(
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

        ctx.recordTokens('code-writer', writerResult.tokenUsage);
        ctx.checkBudget();

        if (!writerResult.success) {
          throw new Error(`Code writer failed: ${writerResult.error}`);
        }

        // 3. Launch test-writer
        const changedFiles = await ctx.commitManager.getChangedFiles();
        const testWriterContextPath = await ctx.contextBuilder.buildForTestWriter(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          changedFiles.map((f) => join(ctx.worktree.path, f)),
          taskPlanPath,
          ctx.progressDir,
        );

        const testResult = await ctx.launcher.launchAgent(
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

        ctx.recordTokens('test-writer', testResult.tokenUsage);
        ctx.checkBudget();

        // 4. Launch code-reviewer
        const diffPath = join(ctx.progressDir, `diff-${task.id}.patch`);
        const diff = await ctx.commitManager.getDiff(ctx.worktree.baseCommit);
        await writeFile(diffPath, diff, 'utf-8');

        const reviewerContextPath = await ctx.contextBuilder.buildForCodeReviewer(
          ctx.issue.number,
          ctx.worktree.path,
          task,
          diffPath,
          taskPlanPath,
          ctx.progressDir,
        );

        const reviewResult = await ctx.launcher.launchAgent(
          {
            agent: 'code-reviewer',
            issueNumber: ctx.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: reviewerContextPath,
            outputPath: join(ctx.progressDir, `review-${task.id}.md`),
          },
          ctx.worktree.path,
        );

        ctx.recordTokens('code-reviewer', reviewResult.tokenUsage);
        ctx.checkBudget();

        // 5. Check review verdict
        if (reviewResult.success) {
          const reviewPath = join(ctx.progressDir, `review-${task.id}.md`);
          if (await exists(reviewPath)) {
            let review;
            try {
              review = await ctx.resultParser.parseReview(reviewPath);
            } catch (err) {
              if (err instanceof ZodError) {
                const msg = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
                ctx.logger.warn(`Review validation failed (will retry): ${msg}`, {
                  issueNumber: ctx.issue.number,
                  taskId: task.id,
                });
              }
              throw err;
            }
            if (review.verdict === 'needs-fixes') {
              // Launch fix-surgeon
              const fixContextPath = await ctx.contextBuilder.buildForFixSurgeon(
                ctx.issue.number,
                ctx.worktree.path,
                task,
                reviewPath,
                changedFiles.map((f) => join(ctx.worktree.path, f)),
                ctx.progressDir,
                'review',
              );

              const fixResult = await ctx.launcher.launchAgent(
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

              ctx.recordTokens('fix-surgeon', fixResult.tokenUsage);
              ctx.checkBudget();

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

    ctx.checkBudget();

    if (retryResult.success) {
      queue.complete(task.id);
      await ctx.checkpoint.completeTask(task.id);
      await ctx.progressWriter.appendEvent(`Task ${task.id} completed`);

      // Commit task
      await ctx.commitManager.commit(
        `implement ${task.name}`,
        ctx.issue.number,
        'feat',
      );
    } else {
      queue.markBlocked(task.id);
      await ctx.checkpoint.blockTask(task.id);
      await ctx.progressWriter.appendEvent(`Task ${task.id} blocked: ${retryResult.error}`);
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

  private async updateProgress(ctx: PhaseContext): Promise<void> {
    const cpState = ctx.checkpoint.getState();
    const taskStatuses: Array<{ id: string; name: string; status: string }> = cpState.completedTasks.map((id) => ({
      id,
      name: id,
      status: 'completed',
    }));

    for (const id of cpState.blockedTasks) {
      taskStatuses.push({ id, name: id, status: 'blocked' });
    }

    await ctx.progressWriter.write(
      [],
      cpState.currentPhase,
      taskStatuses,
      ctx.tokenTracker.getTotal(),
    );
  }
}
