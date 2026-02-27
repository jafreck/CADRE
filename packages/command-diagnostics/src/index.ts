// exec
export {
  type ProcessResult,
  type SpawnOpts,
  stripVSCodeEnv,
  spawnProcess,
  exec,
  execShell,
  trackProcess,
  killAllTrackedProcesses,
  getTrackedProcessCount,
} from './exec.js';

// parse-failures
export { extractFailures } from './parse-failures.js';

// regression
export { type RegressionResult, computeRegressions } from './regression.js';

// verify
export {
  type VerifyCommandConfig,
  type VerifyCommandResult,
  type RunWithRetryConfig,
  type RunWithRetryResult,
  verifyCommand,
} from './verify.js';

// baseline
export {
  baselineResultsSchema,
  type BaselineResults,
  type CaptureBaselineConfig,
  captureBaseline,
} from './baseline.js';
