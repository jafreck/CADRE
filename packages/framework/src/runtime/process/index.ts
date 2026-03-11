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
  resolveLoginShellEnv,
  _resetLoginShellEnvCache,
} from '../commands/exec.js';
