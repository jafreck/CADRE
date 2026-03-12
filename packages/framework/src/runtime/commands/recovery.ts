/**
 * Command execution with automatic retry for infrastructure failures.
 *
 * Composes `execShell` + `classifyError` + exponential backoff.
 * Only retries when the error is classified as 'infra'. Code-quality
 * failures are returned immediately (they require code changes, not retries).
 */

import { execShell, type ProcessResult } from './exec.js';
import { classifyError, type ErrorClass } from './classify-error.js';

export interface RunCommandWithRecoveryOptions {
  command: string;
  cwd: string;
  timeout?: number;
  /** Maximum number of retry attempts for infra failures. Defaults to 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Defaults to 1000. */
  baseDelayMs?: number;
  /** Maximum delay in ms. Defaults to 30000. */
  maxDelayMs?: number;
  /** Called on each retry. */
  onRetry?: (attempt: number, errorClass: ErrorClass, result: ProcessResult) => void;
}

export interface RunCommandWithRecoveryResult {
  result: ProcessResult;
  errorClass: ErrorClass;
  attempts: number;
  retriedInfra: boolean;
}

export async function runCommandWithRecovery(
  opts: RunCommandWithRecoveryOptions,
): Promise<RunCommandWithRecoveryResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30_000;

  let attempts = 0;
  let retriedInfra = false;

  while (true) {
    attempts++;
    const result = await execShell(opts.command, {
      cwd: opts.cwd,
      timeout: opts.timeout,
    });

    if (result.exitCode === 0) {
      return { result, errorClass: 'unknown', attempts, retriedInfra };
    }

    const errorClass = classifyError(result.stderr + result.stdout);

    if (errorClass !== 'infra' || attempts > maxRetries) {
      return { result, errorClass, attempts, retriedInfra };
    }

    // Infrastructure failure — retry with exponential backoff
    retriedInfra = true;
    opts.onRetry?.(attempts, errorClass, result);

    const delay = Math.min(baseDelay * Math.pow(2, attempts - 1), maxDelay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
