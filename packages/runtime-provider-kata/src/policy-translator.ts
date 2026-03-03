import type { IsolationPolicy } from '@cadre/framework/runtime';
import { CapabilityMismatchError } from '@cadre/framework/runtime';
import type { KataSessionConfig } from './types.js';

/**
 * Translate a canonical IsolationPolicy to a KataSessionConfig.
 * Throws CapabilityMismatchError if the policy requests capabilities
 * that the Kata provider does not support (envAllowlist, secrets).
 */
export function translatePolicy(policy: IsolationPolicy): KataSessionConfig {
  const unsupported: string[] = [];
  if (policy.envAllowlist && policy.envAllowlist.length > 0) unsupported.push('envAllowlist');
  if (policy.secrets && policy.secrets.length > 0) unsupported.push('secrets');
  if (unsupported.length > 0) {
    throw new CapabilityMismatchError('kata', unsupported);
  }

  const config: KataSessionConfig = {
    runtime: 'io.containerd.kata.v2',
    networkIsolation: policy.networkMode === 'none',
    readOnlyRootfs: false,
  };

  if (policy.resources?.memoryMb !== undefined) {
    config.memoryLimitBytes = policy.resources.memoryMb * 1024 * 1024;
  }

  if (policy.resources?.cpuShares !== undefined) {
    config.cpuQuota = policy.resources.cpuShares;
  }

  return config;
}
