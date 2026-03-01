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
} from './types.js';

export { ProviderRegistry } from './registry.js';
export { negotiatePolicy, CapabilityMismatchError } from './negotiation.js';
export type { NegotiationOptions } from './negotiation.js';
