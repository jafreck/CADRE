import { join } from 'node:path';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { TaskQueue } from '../execution/task-queue.js';

export class PlanningPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 2;
  readonly name = 'Planning';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.io.progressDir, 'analysis.md');
    const scoutReportPath = join(ctx.io.progressDir, 'scout-report.md');

    const plannerContextPath = await ctx.services.contextBuilder.buildForImplementationPlanner(
      ctx.issue.number,
      ctx.worktree.path,
      analysisPath,
      scoutReportPath,
      ctx.io.progressDir,
    );

    const plannerResult = await launchWithRetry(ctx, 'implementation-planner', {
      agent: 'implementation-planner',
      issueNumber: ctx.issue.number,
      phase: 2,
      contextPath: plannerContextPath,
      outputPath: join(ctx.io.progressDir, 'implementation-plan.md'),
    });

    if (!plannerResult.success) {
      throw new Error(`Implementation planner failed: ${plannerResult.error}`);
    }

    // Validate the plan
    const planPath = join(ctx.io.progressDir, 'implementation-plan.md');
    const tasks = await ctx.services.resultParser.parseImplementationPlan(planPath);

    if (tasks.length === 0) {
      throw new Error('Implementation plan produced zero tasks');
    }

    // Validate dependency graph is acyclic
    try {
      const queue = new TaskQueue(tasks);
      queue.topologicalSort();
    } catch (err) {
      throw new Error(`Invalid implementation plan: ${err}`);
    }

    ctx.services.logger.info(`Plan validated: ${tasks.length} tasks`, {
      issueNumber: ctx.issue.number,
      phase: 2,
    });

    return planPath;
  }
}
