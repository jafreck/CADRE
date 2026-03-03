export interface RegressionResult {
  /** Failures present in the current run but absent from the baseline. */
  regressions: string[];
}

/**
 * Compute regressions by filtering current failures against a known baseline set.
 */
export function computeRegressions(currentFailures: string[], baseline: Set<string>): string[] {
  return currentFailures.filter((f) => !baseline.has(f));
}
