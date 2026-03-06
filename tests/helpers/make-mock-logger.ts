import { vi } from 'vitest';
import type { Logger } from '@cadre-dev/framework/core';

/**
 * Create a mock Logger with all methods stubbed via vi.fn().
 * Includes `.child()` which returns another mock logger.
 */
export function makeMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  } as unknown as Logger;
}
