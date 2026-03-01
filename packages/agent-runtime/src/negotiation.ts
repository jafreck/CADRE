import type { IsolationProvider, IsolationPolicy, NetworkMode } from './types.js';

export class CapabilityMismatchError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly mismatchedAttributes: string[],
  ) {
    super(
      `Provider "${providerName}" does not support the following requested policy attributes: ${mismatchedAttributes.join(', ')}.`
    );
    this.name = 'CapabilityMismatchError';
  }
}

export interface NegotiationOptions {
  allowFallbackToHost?: boolean;
  hostProvider?: IsolationProvider;
}

function findMismatches(provider: IsolationProvider, policy: IsolationPolicy): string[] {
  const caps = provider.capabilities();
  const mismatches: string[] = [];

  if (policy.mounts && policy.mounts.length > 0 && !caps.mounts) {
    mismatches.push('mounts');
  }

  if (policy.networkMode !== undefined) {
    const mode: NetworkMode = policy.networkMode;
    if (!caps.networkModes.includes(mode)) {
      mismatches.push(`networkMode(${mode})`);
    }
  }

  if (policy.envAllowlist && policy.envAllowlist.length > 0 && !caps.envAllowlist) {
    mismatches.push('envAllowlist');
  }

  if (policy.secrets && policy.secrets.length > 0 && !caps.secrets) {
    mismatches.push('secrets');
  }

  if (policy.resources !== undefined && !caps.resources) {
    mismatches.push('resources');
  }

  return mismatches;
}

/**
 * Validates that the provider supports all requested policy attributes.
 * Throws CapabilityMismatchError on mismatch unless allowFallbackToHost is true,
 * in which case the host provider is returned instead.
 */
export function negotiatePolicy(
  provider: IsolationProvider,
  policy: IsolationPolicy,
  options?: NegotiationOptions,
): IsolationProvider {
  const mismatches = findMismatches(provider, policy);

  if (mismatches.length === 0) {
    return provider;
  }

  if (options?.allowFallbackToHost === true && options.hostProvider !== undefined) {
    return options.hostProvider;
  }

  throw new CapabilityMismatchError(provider.name, mismatches);
}
