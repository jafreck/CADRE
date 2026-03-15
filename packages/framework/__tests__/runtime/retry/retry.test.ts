import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryExecutor, RETRY_ORIGINAL, type LoggerLike, type RetryOptions, type RetryResult } from '../../../src/runtime/retry/retry.js';

function makeLogger(): LoggerLike {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('RetryExecutor', () => {
  let logger: LoggerLike;
  let executor: RetryExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    executor = new RetryExecutor(logger);
  });

  it('should succeed on first attempt', async () => {
    const result = await executor.execute({
      fn: async () => 'ok',
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(result.recoveryUsed).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('should retry and eventually succeed', async () => {
    let attempt = 0;
    const result = await executor.execute({
      fn: async () => {
        attempt++;
        if (attempt < 3) throw new Error('not yet');
        return 42;
      },
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.attempts).toBe(3);
    expect(result.recoveryUsed).toBe(false);
  });

  it('should fail after exhausting all attempts with no recovery', async () => {
    const result = await executor.execute({
      fn: async () => { throw new Error('always fail'); },
      maxAttempts: 2,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.recoveryUsed).toBe(false);
    expect(result.error).toContain('always fail');
    expect(result.result).toBeUndefined();
  });

  it('should call onRetry for each intermediate failure', async () => {
    const onRetry = vi.fn();
    let attempt = 0;

    await executor.execute({
      fn: async () => {
        attempt++;
        if (attempt < 3) throw new Error('fail');
        return 'ok';
      },
      maxAttempts: 3,
      baseDelayMs: 1,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it('should use onExhausted recovery when all attempts fail', async () => {
    const result = await executor.execute({
      fn: async () => { throw new Error('fail'); },
      maxAttempts: 2,
      baseDelayMs: 1,
      onExhausted: async () => 'recovered',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('recovered');
    expect(result.attempts).toBe(2);
    expect(result.recoveryUsed).toBe(true);
  });

  it('should fail when onExhausted returns null', async () => {
    const result = await executor.execute({
      fn: async () => { throw new Error('fail'); },
      maxAttempts: 1,
      baseDelayMs: 1,
      onExhausted: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.recoveryUsed).toBe(false);
  });

  it('should fail when onExhausted throws', async () => {
    const result = await executor.execute({
      fn: async () => { throw new Error('fail'); },
      maxAttempts: 1,
      baseDelayMs: 1,
      onExhausted: async () => { throw new Error('recovery failed'); },
    });

    expect(result.success).toBe(false);
    expect(result.recoveryUsed).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('recovery also failed'),
    );
  });

  it('should log warnings for retries and error on exhaustion', async () => {
    await executor.execute({
      fn: async () => { throw new Error('boom'); },
      maxAttempts: 2,
      baseDelayMs: 1,
      description: 'test-op',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('test-op: attempt 1/2 failed'),
      expect.objectContaining({ data: expect.any(Object) }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('test-op: all 2 attempts exhausted'),
    );
  });

  it('should use default description "operation" when not provided', async () => {
    await executor.execute({
      fn: async () => { throw new Error('fail'); },
      maxAttempts: 1,
      baseDelayMs: 1,
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('operation: all 1 attempts exhausted'),
    );
  });

  it('should cap delay at maxDelayMs', async () => {
    let attempt = 0;
    const start = Date.now();

    await executor.execute({
      fn: async () => {
        attempt++;
        if (attempt < 3) throw new Error('fail');
        return 'ok';
      },
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });

    const elapsed = Date.now() - start;
    // With maxDelayMs=5 and baseDelayMs=1, total delay should be well under 50ms
    expect(elapsed).toBeLessThan(200);
  });

  it('should handle single attempt with immediate success', async () => {
    const result = await executor.execute({
      fn: async () => 'single',
      maxAttempts: 1,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should pass the attempt number to fn', async () => {
    const attempts: number[] = [];

    await executor.execute({
      fn: async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new Error('fail');
        return 'ok';
      },
      maxAttempts: 2,
      baseDelayMs: 1,
    });

    expect(attempts).toEqual([1, 2]);
  });

  describe('async onRetry', () => {
    it('should await an async onRetry callback before the delay', async () => {
      const order: string[] = [];
      const onRetry = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('onRetry-done');
      });

      let attempt = 0;
      await executor.execute({
        fn: async () => {
          attempt++;
          if (attempt < 2) throw new Error('fail');
          order.push('fn-success');
          return 'ok';
        },
        maxAttempts: 2,
        baseDelayMs: 1,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['onRetry-done', 'fn-success']);
    });

    it('should still work with a sync onRetry callback', async () => {
      const onRetry = vi.fn();
      let attempt = 0;
      await executor.execute({
        fn: async () => {
          attempt++;
          if (attempt < 2) throw new Error('fail');
          return 'ok';
        },
        maxAttempts: 2,
        baseDelayMs: 1,
        onRetry,
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('computeDelay', () => {
    it('should use computeDelay when provided', async () => {
      const computeDelay = vi.fn(() => 1);
      let attempt = 0;

      await executor.execute({
        fn: async () => {
          attempt++;
          if (attempt < 3) throw new Error('fail');
          return 'ok';
        },
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        computeDelay,
      });

      expect(computeDelay).toHaveBeenCalledTimes(2);
      expect(computeDelay).toHaveBeenCalledWith(1, expect.any(Error), { baseDelayMs: 1000, maxDelayMs: 30000 });
      expect(computeDelay).toHaveBeenCalledWith(2, expect.any(Error), { baseDelayMs: 1000, maxDelayMs: 30000 });
    });

    it('should allow error-adaptive delays', async () => {
      const start = Date.now();
      let attempt = 0;

      await executor.execute({
        fn: async () => {
          attempt++;
          if (attempt < 3) throw new Error('infra-503');
          return 'ok';
        },
        maxAttempts: 3,
        baseDelayMs: 10000, // default would be slow
        computeDelay: (_attempt, error) => {
          // fast retry for infra errors
          if (String(error).includes('infra')) return 1;
          return 5000;
        },
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200); // should be near-instant, not 10s+
    });
  });

  describe('onExhausted with RETRY_ORIGINAL', () => {
    it('should retry the original fn one more time when onExhausted returns RETRY_ORIGINAL', async () => {
      let attempt = 0;
      const result = await executor.execute({
        fn: async (a) => {
          attempt++;
          // Fail on first 2 attempts, succeed on 3rd (the retry-original)
          if (attempt <= 2) throw new Error('fail');
          return `success-attempt-${a}`;
        },
        maxAttempts: 2,
        baseDelayMs: 1,
        onExhausted: async () => RETRY_ORIGINAL,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success-attempt-3');
      expect(result.attempts).toBe(3);
      expect(result.recoveryUsed).toBe(true);
    });

    it('should fail when RETRY_ORIGINAL retry also fails', async () => {
      const result = await executor.execute({
        fn: async () => { throw new Error('always fail'); },
        maxAttempts: 1,
        baseDelayMs: 1,
        onExhausted: async () => RETRY_ORIGINAL,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.recoveryUsed).toBe(true);
      expect(result.error).toContain('always fail');
    });

    it('should still support direct recovery values alongside RETRY_ORIGINAL', async () => {
      const result = await executor.execute({
        fn: async () => { throw new Error('fail'); },
        maxAttempts: 1,
        baseDelayMs: 1,
        onExhausted: async () => 'direct-recovery',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('direct-recovery');
      expect(result.recoveryUsed).toBe(true);
    });
  });
});
