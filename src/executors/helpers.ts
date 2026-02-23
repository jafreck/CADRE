import type { PhaseContext } from '../core/phase-executor.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';

/**
 * Launch an agent with retry logic, budget checks, and token recording.
 * Shared by all phase executors.
 */
export async function launchWithRetry(
  ctx: PhaseContext,
  agentName: string,
  invocation: Omit<AgentInvocation, 'timeout'>,
): Promise<AgentResult> {
  const result = await ctx.services.retryExecutor.execute<AgentResult>({
    fn: async () => {
      ctx.callbacks.checkBudget();
      const agentResult = await ctx.services.launcher.launchAgent(
        invocation as AgentInvocation,
        ctx.worktree.path,
      );
      ctx.callbacks.recordTokens(agentName, agentResult.tokenUsage);
      ctx.callbacks.checkBudget();
      if (!agentResult.success) {
        throw new Error(agentResult.error ?? `Agent ${agentName} failed`);
      }
      return agentResult;
    },
    maxAttempts: ctx.config.options.maxRetriesPerTask,
    description: agentName,
  });

  ctx.callbacks.checkBudget();

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
