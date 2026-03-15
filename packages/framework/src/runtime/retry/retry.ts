/**
 * Minimal logger interface accepted by RetryExecutor.
 * Any logger with warn/info/error methods satisfies this contract.
 */
export interface LoggerLike {
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Branded sentinel returned by onExhausted to request one more attempt
 * of the original fn() instead of providing a recovery result directly.
 */
export interface RetryOriginal {
  readonly __brand: 'RetryOriginal';
  readonly retryOriginal: true;
}

export const RETRY_ORIGINAL: RetryOriginal = Object.freeze({ __brand: 'RetryOriginal' as const, retryOriginal: true as const });

function isRetryOriginal<T>(value: T | RetryOriginal | null): value is RetryOriginal {
  return value !== null && typeof value === 'object' && '__brand' in value && (value as RetryOriginal).__brand === 'RetryOriginal';
}

export interface RetryOptions<T> {
  /** The operation to retry. */
  fn: (attempt: number) => Promise<T>;
  /** Maximum number of attempts. */
  maxAttempts: number;
  /** Base delay in ms for exponential backoff. */
  baseDelayMs?: number;
  /** Maximum delay in ms. */
  maxDelayMs?: number;
  /** Called on each retry. May be async. */
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
  /**
   * Called when all retries exhausted.
   * Return a recovered value, RETRY_ORIGINAL to re-run fn() one more time, or null to give up.
   */
  onExhausted?: (error: unknown) => Promise<T | RetryOriginal | null>;
  /** Override the default exponential-backoff delay calculation. */
  computeDelay?: (attempt: number, error: unknown, defaults: { baseDelayMs: number; maxDelayMs: number }) => number;
  /** Description for logging. */
  description?: string;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  recoveryUsed: boolean;
  error?: string;
}

/**
 * Retry executor with exponential backoff, jitter, and failure-recovery escalation.
 */
export class RetryExecutor {
  constructor(private readonly logger: LoggerLike) {}

  /**
   * Execute an operation with retry logic.
   */
  async execute<T>(opts: RetryOptions<T>): Promise<RetryResult<T>> {
    const {
      fn,
      maxAttempts,
      baseDelayMs = 1000,
      maxDelayMs = 30_000,
      onRetry,
      onExhausted,
      computeDelay,
      description = 'operation',
    } = opts;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn(attempt);
        return {
          success: true,
          result,
          attempts: attempt,
          recoveryUsed: false,
        };
      } catch (err) {
        lastError = err;

        if (attempt < maxAttempts) {
          const delay = computeDelay
            ? computeDelay(attempt, err, { baseDelayMs, maxDelayMs })
            : Math.min(
                baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs,
                maxDelayMs,
              );

          this.logger.warn(
            `${description}: attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`,
            { data: { error: String(err) } },
          );

          await onRetry?.(attempt, err);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — try recovery if available
    if (onExhausted) {
      this.logger.info(`${description}: all ${maxAttempts} attempts failed, trying recovery`);

      try {
        const recovered = await onExhausted(lastError);
        if (isRetryOriginal(recovered)) {
          this.logger.info(`${description}: recovery requested retry of original operation`);
          try {
            const retryResult = await fn(maxAttempts + 1);
            return {
              success: true,
              result: retryResult,
              attempts: maxAttempts + 1,
              recoveryUsed: true,
            };
          } catch (retryErr) {
            this.logger.error(`${description}: post-recovery retry failed: ${retryErr}`);
            return {
              success: false,
              attempts: maxAttempts + 1,
              recoveryUsed: true,
              error: String(retryErr),
            };
          }
        }
        if (recovered !== null) {
          this.logger.info(`${description}: recovery succeeded`);
          return {
            success: true,
            result: recovered,
            attempts: maxAttempts,
            recoveryUsed: true,
          };
        }
      } catch (recoveryErr) {
        this.logger.error(`${description}: recovery also failed: ${recoveryErr}`);
      }
    }

    this.logger.error(`${description}: all ${maxAttempts} attempts exhausted`);
    return {
      success: false,
      attempts: maxAttempts,
      recoveryUsed: false,
      error: String(lastError),
    };
  }
}
