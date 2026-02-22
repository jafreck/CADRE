import pLimit from 'p-limit';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import type { AgentLauncherLike } from './serial-executor.js';
import { Logger } from '../logging/logger.js';

/**
 * Runs agent invocations concurrently with bounded parallelism.
 */
export class ParallelExecutor {
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    private readonly launcher: AgentLauncherLike,
    private readonly maxConcurrency: number,
    private readonly logger: Logger,
  ) {
    this.limit = pLimit(maxConcurrency);
  }

  /**
   * Execute a list of invocations in parallel with bounded concurrency.
   * Returns results in the same order as invocations.
   */
  async execute(
    invocations: AgentInvocation[],
    worktreePath: string,
    opts?: { delayMs?: number },
  ): Promise<AgentResult[]> {
    this.logger.debug(
      `Parallel executor: launching ${invocations.length} agents (max ${this.maxConcurrency} concurrent)`,
    );

    let index = 0;
    const results = await Promise.all(
      invocations.map((invocation) =>
        this.limit(async () => {
          const i = index++;

          // Optional staggered delay
          if (opts?.delayMs && opts.delayMs > 0 && i > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.delayMs! * i));
          }

          this.logger.debug(`Parallel executor: launching ${invocation.agent}`, {
            issueNumber: invocation.issueNumber,
            taskId: invocation.taskId,
          });

          return this.launcher.launchAgent(invocation, worktreePath);
        }),
      ),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    this.logger.info(`Parallel executor: ${succeeded} succeeded, ${failed} failed`);

    return results;
  }

  /**
   * Execute invocations, settling all (no early abort).
   * Returns results with success/failure for each.
   */
  async executeSettled(
    invocations: AgentInvocation[],
    worktreePath: string,
  ): Promise<AgentResult[]> {
    const settled = await Promise.allSettled(
      invocations.map((invocation) =>
        this.limit(() => this.launcher.launchAgent(invocation, worktreePath)),
      ),
    );

    return settled.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        agent: invocations[i].agent,
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 0,
        stdout: '',
        stderr: String(result.reason),
        tokenUsage: 0,
        outputPath: invocations[i].outputPath,
        outputExists: false,
        error: String(result.reason),
      } satisfies AgentResult;
    });
  }
}
