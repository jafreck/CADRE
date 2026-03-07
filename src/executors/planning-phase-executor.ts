import { join } from 'node:path';
import type { PhaseExecutor, PhaseContext } from '../core/pipeline/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { SessionQueue } from '@cadre-dev/framework/engine';
import { exists } from '../util/fs.js';

export class PlanningPhaseExecutor implements PhaseExecutor {
  readonly id = 2;
  readonly name = 'Planning';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.io.progressDir, 'analysis.md');
    const scoutReportPath = join(ctx.io.progressDir, 'scout-report.md');
    const fileTreePath = join(ctx.io.progressDir, 'repo-file-tree.txt');
    const analysis = await ctx.services.resultParser.parseAnalysis(analysisPath);
    const scoutRequired = analysis.scoutPolicy === 'required';
    const scoutAvailable = await exists(scoutReportPath);

    if (scoutRequired && !scoutAvailable) {
      throw new Error(
        'scout-report.md is required by issue-analyst scoutPolicy=required but is missing from the progress directory',
      );
    }

    const plannerContextPath = await ctx.services.contextBuilder.build('implementation-planner', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      analysisPath,
      scoutReportPath,
      fileTreePath,
      scoutRequired,
      scoutAvailable,
      progressDir: ctx.io.progressDir,
    });

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
