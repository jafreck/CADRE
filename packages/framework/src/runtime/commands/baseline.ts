import { z } from 'zod';
import { execShell } from './exec.js';
import { extractFailures } from './parse-failures.js';

export const baselineResultsSchema = z.object({
  buildExitCode: z.number(),
  testExitCode: z.number(),
  buildFailures: z.array(z.string()),
  testFailures: z.array(z.string()),
});

export type BaselineResults = z.infer<typeof baselineResultsSchema>;

export interface CaptureBaselineConfig {
  cwd: string;
  buildCommand?: string;
  testCommand?: string;
  timeout?: number;
}

/**
 * Run build and test commands and collect baseline results.
 * Pure command-running logic — no file I/O.
 */
export async function captureBaseline(config: CaptureBaselineConfig): Promise<BaselineResults> {
  const { cwd, buildCommand, testCommand, timeout = 300_000 } = config;

  let buildExitCode = 0;
  let testExitCode = 0;
  let buildFailures: string[] = [];
  let testFailures: string[] = [];

  if (buildCommand) {
    const result = await execShell(buildCommand, { cwd, timeout });
    buildExitCode = result.exitCode ?? 1;
    if (buildExitCode !== 0) {
      buildFailures = extractFailures(result.stderr + result.stdout);
    }
  }

  if (testCommand) {
    const result = await execShell(testCommand, { cwd, timeout });
    testExitCode = result.exitCode ?? 1;
    if (testExitCode !== 0) {
      testFailures = extractFailures(result.stderr + result.stdout);
    }
  }

  return { buildExitCode, testExitCode, buildFailures, testFailures };
}
