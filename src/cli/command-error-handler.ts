import chalk from 'chalk';
import { StaleStateError, RuntimeInterruptedError } from '../errors.js';
import { ConfigLoadError } from '../config/loader.js';

/**
 * Centralized error handler for CLI command actions.
 */
export function handleCommandError(err: unknown): never {
  if (err instanceof StaleStateError) {
    const { conflicts } = err.result;
    for (const [issueNumber, issueConflicts] of conflicts) {
      console.error(chalk.red(`Issue #${issueNumber} has stale state conflicts:`));
      for (const conflict of issueConflicts) {
        console.error(chalk.yellow(`  [${conflict.kind}] ${conflict.description}`));
      }
    }
    process.exit(1);
  } else if (err instanceof RuntimeInterruptedError) {
    process.exit(err.exitCode);
  } else if (err instanceof ConfigLoadError) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    process.exit(1);
  }
}

/**
 * Wrap an async commander action handler with standardized error handling.
 */
export function withCommandHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      handleCommandError(err);
    }
  };
}
