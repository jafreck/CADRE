/**
 * Minimal logger interface accepted by RetryExecutor.
 * Any logger with warn/info/error methods satisfies this contract.
 */
export interface LoggerLike {
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
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
  /** Called on each retry. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Called when all retries exhausted. Returns recovery result if successful. */
  onExhausted?: (error: unknown) => Promise<T | null>;
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
          // Calculate delay with exponential backoff + jitter
          const delay = Math.min(
            baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs,
            maxDelayMs,
          );

          this.logger.warn(
            `${description}: attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`,
            { data: { error: String(err) } },
          );

          onRetry?.(attempt, err);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — try recovery if available
    if (onExhausted) {
      this.logger.info(`${description}: all ${maxAttempts} attempts failed, trying recovery`);

      try {
        const recovered = await onExhausted(lastError);
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
