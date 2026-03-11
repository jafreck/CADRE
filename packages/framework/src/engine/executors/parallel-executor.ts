import pLimit from 'p-limit';
import type { AgentInvocation, AgentResult } from '../../runtime/context/types.js';
import type { AgentLauncherLike } from './serial-executor.js';
import type { Logger } from '../../core/logger.js';

/**
 * Runs agent invocations concurrently with bounded parallelism.
 */
export class ParallelExecutor {
  private readonly limit: ReturnType<typeof pLimit>;
  private _activeConcurrency = 0;
  private _peakConcurrency = 0;

  /** High-water mark of concurrent agent launches observed so far. */
  get peakConcurrency(): number {
    return this._peakConcurrency;
  }

  constructor(
    private readonly launcher: AgentLauncherLike,
    private readonly maxConcurrency: number,
    private readonly logger: Logger,
  ) {
    this.limit = pLimit(maxConcurrency);
  }

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

          if (opts?.delayMs && opts.delayMs > 0 && i > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.delayMs! * i));
          }

          this.logger.debug(`Parallel executor: launching ${invocation.agent}`, {
            workItemId: invocation.workItemId,
            sessionId: invocation.sessionId,
          });

          this._activeConcurrency++;
          if (this._activeConcurrency > this._peakConcurrency) {
            this._peakConcurrency = this._activeConcurrency;
          }
          try {
            return await this.launcher.launchAgent(invocation, worktreePath);
          } finally {
            this._activeConcurrency--;
          }
        }),
      ),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    this.logger.info(`Parallel executor: ${succeeded} succeeded, ${failed} failed (peak concurrency: ${this._peakConcurrency})`);

    return results;
  }

  async executeSettled(
    invocations: AgentInvocation[],
    worktreePath: string,
  ): Promise<AgentResult[]> {
    const settled = await Promise.allSettled(
      invocations.map((invocation) =>
        this.limit(async () => {
          this._activeConcurrency++;
          if (this._activeConcurrency > this._peakConcurrency) {
            this._peakConcurrency = this._activeConcurrency;
          }
          try {
            return await this.launcher.launchAgent(invocation, worktreePath);
          } finally {
            this._activeConcurrency--;
          }
        }),
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
