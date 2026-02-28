import type { AgentInvocation, AgentResult } from './context/types.js';
import type { RetryOptions, RetryResult } from './retry/retry.js';
import { RetryExecutor, type LoggerLike } from './retry/retry.js';
import { TokenTracker } from './budget/token-tracker.js';
import { AgentLauncher } from './launcher/agent-launcher.js';
/** Options for launchWithRetry (extends RetryOptions minus fn). */
export interface LaunchWithRetryOptions {
  /** The invocation request to execute. */
  invocation: AgentInvocation;
  /** Worktree path for the agent. */
  worktreePath: string;
  /** Maximum number of retry attempts. */
  maxAttempts: number;
  /** Base delay in ms for exponential backoff. */
  baseDelayMs?: number;
  /** Maximum delay in ms. */
  maxDelayMs?: number;
  /** Called on each retry. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Called when all retries exhausted. Returns recovery result if successful. */
  onExhausted?: (error: unknown) => Promise<AgentResult | null>;
  /** Description for logging. */
  description?: string;
}

/**
 * Convenience helper that composes AgentLauncher + RetryExecutor + TokenTracker
 * into a single "launch with retry" call.
 */
export async function launchWithRetry(
  launcher: AgentLauncher,
  options: LaunchWithRetryOptions,
  tokenTracker: TokenTracker,
  logger: LoggerLike,
): Promise<RetryResult<AgentResult>> {
  const retryExecutor = new RetryExecutor(logger);

  const retryOpts: RetryOptions<AgentResult> = {
    fn: async (_attempt: number) => {
      const result = await launcher.launchAgent(options.invocation, options.worktreePath);
      if (!result.success) {
        throw new Error(result.error ?? `Agent ${options.invocation.agent} failed`);
      }
      return result;
    },
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    onRetry: options.onRetry,
    onExhausted: options.onExhausted,
    description: options.description ?? `agent ${options.invocation.agent}`,
  };

  const retryResult = await retryExecutor.execute(retryOpts);

  // Track token usage from the final result
  if (retryResult.result) {
    const usage = retryResult.result.tokenUsage;
    const tokens = typeof usage === 'number' ? usage : (usage ? usage.input + usage.output : 0);
    tokenTracker.record(
      options.invocation.issueNumber,
      options.invocation.agent,
      options.invocation.phase,
      tokens,
    );
  }

  return retryResult;
}
