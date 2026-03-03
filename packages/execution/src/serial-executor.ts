import type { AgentInvocation, AgentResult } from '@cadre/agent-runtime';
import type { Logger } from '@cadre/observability';

/**
 * Runs agent invocations serially, one after another.
 */
export class SerialExecutor {
  constructor(
    private readonly launcher: AgentLauncherLike,
    private readonly logger: Logger,
  ) {}

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
        sessionId: invocation.sessionId,
      });

      const result = await this.launcher.launchAgent(invocation, worktreePath);
      results.push(result);

      if (!result.success && opts?.stopOnFailure) {
        this.logger.warn(`Serial executor: stopping due to failure in ${invocation.agent}`, {
          issueNumber: invocation.issueNumber,
        });
        break;
      }

      if (opts?.delayMs && opts.delayMs > 0 && i < invocations.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }

    return results;
  }
}

export interface AgentLauncherLike {
  launchAgent(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult>;
}
