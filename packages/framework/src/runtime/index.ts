// @cadre/framework/runtime — agent runtime, command diagnostics, host provider

// === From agent-runtime ===
export * from './budget/token-tracker.js';
export * from './output/cadre-json.js';
export * from './context/types.js';

export type { AgentContract } from './contract.js';
export { defineContract } from './contract.js';

export * from './retry/retry.js';
export * from './backend/backend.js';
export * from './backend/factory.js';
export * from './launcher/agent-launcher.js';
export * from './process/index.js';
export * from './launch-with-retry.js';

export type {
  MountSpec,
  UlimitSpec,
  ResourceLimits,
  SecretBinding,
  NetworkMode,
  IsolationPolicy,
  IsolationCapabilities,
  ExecOptions,
  ExecResult,
  IsolationSession,
  IsolationProvider,
  IsolationProviderHealthCheckResult,
} from './types.js';

export { ProviderRegistry } from './registry.js';
export type { ProviderFactory, ProviderRegistration, ProviderDescriptor } from './registry.js';
export { negotiatePolicy, CapabilityMismatchError } from './negotiation.js';
export type { NegotiationOptions } from './negotiation.js';

// === From command-diagnostics ===
export { extractFailures } from './commands/parse-failures.js';
export { type RegressionResult, computeRegressions } from './commands/regression.js';
export {
  type VerifyCommandConfig,
  type VerifyCommandResult,
  type RunWithRetryConfig,
  type RunWithRetryResult,
  verifyCommand,
} from './commands/verify.js';
export {
  baselineResultsSchema,
  type BaselineResults,
  type CaptureBaselineConfig,
  captureBaseline,
} from './commands/baseline.js';

// === From agent-runtime-provider-host ===
export { HostProvider } from './providers/host/host-provider.js';
export { HostSession } from './providers/host/host-session.js';
