/** IsolationPolicy defines the resource and security constraints for an agent session. */
export type IsolationPolicy = {
  /** Memory limit in bytes */
  memory?: number;
  /** CPU quota (e.g. number of cores or millicores) */
  cpu?: number;
  /** Whether to enable network isolation (no external network access) */
  networkIsolation?: boolean;
  /** Whether to mount the container root filesystem as read-only */
  readOnlyRootfs?: boolean;
  /** Additional policy fields for forward-compatibility */
  [key: string]: unknown;
};

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

/**
 * IsolationProvider is the local placeholder for the contract defined in issue #271.
 * Replace with the shared interface once that package is available.
 */
export interface IsolationProvider {
  /** Start a new isolated session and return its session ID. */
  startSession(policy: IsolationPolicy): Promise<string>;
  /** Execute a command inside the given session. */
  exec(sessionId: string, command: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Gracefully stop the given session. */
  stopSession(sessionId: string): Promise<void>;
  /** Forcefully destroy the given session and release all resources. */
  destroySession(sessionId: string): Promise<void>;
}

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
