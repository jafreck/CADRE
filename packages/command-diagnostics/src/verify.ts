import { execShell } from './exec.js';
import { extractFailures } from './parse-failures.js';
import { computeRegressions } from './regression.js';

export interface VerifyCommandConfig {
  command: string;
  cwd: string;
  timeout: number;
  maxFixRounds: number;
  /** When provided, enables regression-based mode: only failures absent from the baseline trigger fixes. */
  baseline?: Set<string>;
  /** Fallback failure value when extractFailures returns empty on a non-zero exit. */
  sentinelValue?: string;
  /** Called when fixes are needed. Receives the combined command output and the current round index. */
  onFixNeeded: (output: string, round: number) => Promise<void>;
}

export interface VerifyCommandResult {
  exitCode: number | null;
  failures: string[];
  regressions: string[];
  output: string;
}

/** Backward-compatible aliases */
export type RunWithRetryConfig = VerifyCommandConfig;
export type RunWithRetryResult = VerifyCommandResult;

/**
 * Run a shell command with an extract-failures / diff-baseline / fix / retry loop.
 *
 * Two modes:
 * - **Regression mode** (baseline provided): regressions = failures not in baseline. Retries while regressions exist.
 * - **Exit-code mode** (no baseline): any non-zero exit triggers the fix callback. Retries while exit code ≠ 0.
 */
export async function verifyCommand(config: VerifyCommandConfig): Promise<VerifyCommandResult> {
  const { command, cwd, timeout, maxFixRounds, baseline, sentinelValue, onFixNeeded } = config;

  let result = await execShell(command, { cwd, timeout });
  let output = result.stderr + result.stdout;
  let failures = extractFailures(output);

  if (result.exitCode !== 0 && failures.length === 0 && sentinelValue) {
    failures = [sentinelValue];
  }

  let regressions = baseline ? computeRegressions(failures, baseline) : [];

  const shouldRetry = (): boolean => {
    if (baseline) return regressions.length > 0;
    return result.exitCode !== 0;
  };

  for (let round = 0; round < maxFixRounds && shouldRetry(); round++) {
    await onFixNeeded(output, round);

    result = await execShell(command, { cwd, timeout });
    output = result.stderr + result.stdout;
    failures = extractFailures(output);

    if (result.exitCode !== 0 && failures.length === 0 && sentinelValue) {
      failures = [sentinelValue];
    }

    regressions = baseline ? computeRegressions(failures, baseline) : [];
  }

  return {
    exitCode: result.exitCode,
    failures,
    regressions,
    output,
  };
}
