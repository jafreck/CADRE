import type { IsolationPolicy, KataSessionConfig } from "./types.js";
import { CapabilityMismatchError } from "./types.js";

/** Known IsolationPolicy keys that this provider supports. */
const SUPPORTED_KEYS = new Set<string>(["memory", "cpu", "networkIsolation", "readOnlyRootfs"]);

/**
 * Translate an IsolationPolicy to a KataSessionConfig.
 * Throws CapabilityMismatchError if any unknown policy fields are present.
 */
export function translatePolicy(policy: IsolationPolicy): KataSessionConfig {
  const unsupported: string[] = Object.keys(policy).filter((k) => !SUPPORTED_KEYS.has(k));
  if (unsupported.length > 0) {
    throw new CapabilityMismatchError(unsupported);
  }

  const config: KataSessionConfig = {
    runtime: "io.containerd.kata.v2",
    networkIsolation: policy.networkIsolation ?? false,
    readOnlyRootfs: policy.readOnlyRootfs ?? false,
  };

  if (policy.memory !== undefined) {
    config.memoryLimitBytes = policy.memory;
  }

  if (policy.cpu !== undefined) {
    config.cpuQuota = policy.cpu;
  }

  return config;
}
