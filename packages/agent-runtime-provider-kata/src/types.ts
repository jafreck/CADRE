/**
 * Kata-specific type definitions.
 * Canonical isolation types (IsolationProvider, IsolationPolicy, etc.) come from @cadre/agent-runtime.
 */

/** KataSessionConfig holds the Kata OCI/VM runtime parameters produced by policy translation. */
export type KataSessionConfig = {
  /** OCI runtime to use (e.g. "io.containerd.kata.v2") */
  runtime: string;
  /** Memory limit in bytes passed to the VM */
  memoryLimitBytes?: number;
  /** CPU quota passed to the VM */
  cpuQuota?: number;
  /** Whether network isolation is enforced */
  networkIsolation: boolean;
  /** Whether the root filesystem is mounted read-only */
  readOnlyRootfs: boolean;
  /** Arbitrary OCI annotations forwarded to the Kata runtime */
  annotations?: Record<string, string>;
};

/** Thrown when one or more IsolationPolicy fields cannot be satisfied by the Kata provider. */
export class CapabilityMismatchError extends Error {
  /** The policy fields that the Kata provider does not support. */
  readonly unsupportedPolicies: string[];

  constructor(unsupportedPolicies: string[], message?: string) {
    super(message ?? `Kata provider does not support the following policies: ${unsupportedPolicies.join(", ")}`);
    this.name = "CapabilityMismatchError";
    this.unsupportedPolicies = unsupportedPolicies;
  }
}
