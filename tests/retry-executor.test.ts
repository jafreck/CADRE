import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryExecutor } from '../src/execution/retry.js';
import { Logger } from '../src/logging/logger.js';

describe('RetryExecutor', () => {
  let executor: RetryExecutor;

  beforeEach(() => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    executor = new RetryExecutor(mockLogger);
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
  });

  it('should retry on failure and succeed eventually', async () => {
    let attempt = 0;
    const result = await executor.execute({
      fn: async () => {
        attempt++;
        if (attempt < 3) throw new Error('not yet');
        return 'ok';
      },
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('should fail after exhausting all attempts', async () => {
    const result = await executor.execute({
      fn: async () => {
        throw new Error('always fail');
      },
      maxAttempts: 2,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('should call onRetry callback on each retry', async () => {
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

  it('should use recovery callback when retries exhausted', async () => {
    const result = await executor.execute({
      fn: async () => {
        throw new Error('fail');
      },
      maxAttempts: 1,
      baseDelayMs: 1,
      onExhausted: async () => 'recovered',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('recovered');
    expect(result.recoveryUsed).toBe(true);
  });

  it('should fail if recovery also fails', async () => {
    const result = await executor.execute({
      fn: async () => {
        throw new Error('fail');
      },
      maxAttempts: 1,
      baseDelayMs: 1,
      onExhausted: async () => {
        throw new Error('recovery also failed');
      },
    });

    expect(result.success).toBe(false);
  });

  it('should fail if recovery returns null', async () => {
    const result = await executor.execute({
      fn: async () => {
        throw new Error('fail');
      },
      maxAttempts: 1,
      baseDelayMs: 1,
      onExhausted: async () => null,
    });

    expect(result.success).toBe(false);
  });
});
