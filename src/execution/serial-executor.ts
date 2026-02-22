import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { Logger } from '../logging/logger.js';

/**
 * Runs agent invocations serially, one after another.
 */
export class SerialExecutor {
  constructor(
    private readonly launcher: AgentLauncherLike,
    private readonly logger: Logger,
  ) {}

  /**
   * Execute a list of invocations serially.
   * Stops at the first failure if `stopOnFailure` is true.
   */
  async execute(
    invocations: AgentInvocation[],
    worktreePath: string,
    opts?: {
      stopOnFailure?: boolean;
      delayMs?: number;
    },
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    for (let i = 0; i < invocations.length; i++) {
      const invocation = invocations[i];

      this.logger.debug(`Serial executor: launching ${invocation.agent} (${i + 1}/${invocations.length})`, {
        issueNumber: invocation.issueNumber,
        taskId: invocation.taskId,
      });

      const result = await this.launcher.launchAgent(invocation, worktreePath);
      results.push(result);

      if (!result.success && opts?.stopOnFailure) {
        this.logger.warn(`Serial executor: stopping due to failure in ${invocation.agent}`, {
          issueNumber: invocation.issueNumber,
        });
        break;
      }

      // Optional delay between invocations (rate limiting)
      if (opts?.delayMs && opts.delayMs > 0 && i < invocations.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }

    return results;
  }
}

/**
 * Interface for the agent launcher, to decouple executor from implementation.
 */
export interface AgentLauncherLike {
  launchAgent(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult>;
}
