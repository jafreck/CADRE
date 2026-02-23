import { join } from 'node:path';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { TaskQueue } from '../execution/task-queue.js';

export class PlanningPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 2;
  readonly name = 'Planning';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.progressDir, 'analysis.md');
    const scoutReportPath = join(ctx.progressDir, 'scout-report.md');

    const plannerContextPath = await ctx.contextBuilder.buildForImplementationPlanner(
      ctx.issue.number,
      ctx.worktree.path,
      analysisPath,
      scoutReportPath,
      ctx.progressDir,
    );

    const plannerResult = await this.launchWithRetry(ctx, 'implementation-planner', {
      agent: 'implementation-planner',
      issueNumber: ctx.issue.number,
      phase: 2,
      contextPath: plannerContextPath,
      outputPath: join(ctx.progressDir, 'implementation-plan.md'),
    });

    if (!plannerResult.success) {
      throw new Error(`Implementation planner failed: ${plannerResult.error}`);
    }

    // Validate the plan
    const planPath = join(ctx.progressDir, 'implementation-plan.md');
    const tasks = await ctx.resultParser.parseImplementationPlan(planPath);

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

    ctx.logger.info(`Plan validated: ${tasks.length} tasks`, {
      issueNumber: ctx.issue.number,
      phase: 2,
    });

    return planPath;
  }

  private async launchWithRetry(
    ctx: PhaseContext,
    agentName: string,
    invocation: Omit<AgentInvocation, 'timeout'>,
  ): Promise<AgentResult> {
    const result = await ctx.retryExecutor.execute<AgentResult>({
      fn: async () => {
        ctx.checkBudget();
        const agentResult = await ctx.launcher.launchAgent(
          invocation as AgentInvocation,
          ctx.worktree.path,
        );
        ctx.recordTokens(agentName, agentResult.tokenUsage);
        ctx.checkBudget();
        if (!agentResult.success) {
          throw new Error(agentResult.error ?? `Agent ${agentName} failed`);
        }
        return agentResult;
      },
      maxAttempts: ctx.config.options.maxRetriesPerTask,
      description: agentName,
    });

    ctx.checkBudget();

    if (!result.success || !result.result) {
      return {
        agent: invocation.agent,
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 0,
        stdout: '',
        stderr: result.error ?? 'Unknown failure',
        tokenUsage: null,
        outputPath: invocation.outputPath,
        outputExists: false,
        error: result.error,
      };
    }

    return result.result;
  }
}
