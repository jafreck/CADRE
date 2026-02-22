import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../src/logging/logger.js';

// We'll mock fs to avoid actual file writes
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({
      source: 'test',
      logDir: '/tmp/logs',
      level: 'debug',
      console: false,
    });
  });

  it('should be constructable', () => {
    expect(logger).toBeDefined();
  });

  it('should have log level methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should create child loggers', () => {
    const childLogger = logger.child(42);
    expect(childLogger).toBeDefined();
    expect(typeof childLogger.info).toBe('function');
  });

  it('should create agent loggers', () => {
    const agentLog = logger.agentLogger(42, 'issue-analyst', 'task-001');
    expect(agentLog).toBeDefined();
    expect(typeof agentLog.info).toBe('function');
  });

  it('should respect log levels', () => {
    const warnLogger = new Logger({
      source: 'test',
      logDir: '/tmp/logs',
      level: 'warn',
      console: false,
    });
    // Debug and info should be effectively no-ops
    // This verifies the logger doesn't throw
    warnLogger.debug('test debug');
    warnLogger.info('test info');
    warnLogger.warn('test warn');
    warnLogger.error('test error');
  });
});
