import { join } from 'node:path';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { SessionQueue } from '../execution/task-queue.js';

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
    const sessions = await ctx.services.resultParser.parseImplementationPlan(planPath);

    if (sessions.length === 0) {
      throw new Error(
        'Implementation plan produced zero sessions. ' +
        'The implementation-planner agent did not emit a valid `cadre-json` block or any parseable session sections. ' +
        `Check ${join(ctx.io.progressDir, 'implementation-plan.md')} — the agent must output a ` +
        '```cadre-json``` fenced block containing a JSON array of session objects (see agent template for schema).',
      );
    }

    // Validate dependency graph is acyclic
    try {
      const queue = new SessionQueue(sessions);
      queue.topologicalSort();
    } catch (err) {
      throw new Error(`Invalid implementation plan: ${err}`);
    }

    ctx.services.logger.info(`Plan validated: ${sessions.length} sessions`, {
      issueNumber: ctx.issue.number,
      phase: 2,
    });

    return planPath;
  }
}
