import { randomUUID } from 'node:crypto';
import type {
  ExecOptions,
  ExecResult,
  IsolationCapabilities,
  IsolationPolicy,
  IsolationProvider,
  IsolationProviderHealthCheckResult,
  IsolationSession,
} from '@cadre-dev/framework/runtime';
import type { KataSessionConfig } from './types.js';
import { translatePolicy } from './policy-translator.js';

/**
 * Minimal Kata OCI adapter interface.
 * Replace with a real Kata OCI/containerd adapter when available.
 */
export interface KataAdapter {
  createSandbox(sessionId: string, config: KataSessionConfig): Promise<void>;
  execInSandbox(sessionId: string, command: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  stopSandbox(sessionId: string): Promise<void>;
  destroySandbox(sessionId: string): Promise<void>;
  healthCheck?(): Promise<{ healthy: boolean; version?: string }>;
}

/** Default stub adapter — all operations are no-ops returning empty results. */
export class StubKataAdapter implements KataAdapter {
  async createSandbox(_sessionId: string, _config: KataSessionConfig): Promise<void> {}

  async execInSandbox(
    _sessionId: string,
    _command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  async stopSandbox(_sessionId: string): Promise<void> {}

  async destroySandbox(_sessionId: string): Promise<void> {}

  async healthCheck(): Promise<{ healthy: boolean; version?: string }> {
    return { healthy: true, version: 'stub' };
  }
}

/** IsolationSession backed by a Kata sandbox. */
class KataSession implements IsolationSession {
  readonly sessionId: string;
  private readonly adapter: KataAdapter;
  private destroyed = false;

  constructor(sessionId: string, adapter: KataAdapter) {
    this.sessionId = sessionId;
    this.adapter = adapter;
  }

  async exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    if (this.destroyed) {
      throw new Error(`KataSession ${this.sessionId} has been destroyed`);
    }

    // Build the command array, wrapping for cwd/env if needed
    let cmd: string[];
    if (options?.cwd && options?.env) {
      const envPairs = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);
      cmd = ['env', ...envPairs, 'sh', '-c', `cd ${options.cwd} && exec "$@"`, '--', command, ...args];
    } else if (options?.cwd) {
      cmd = ['sh', '-c', `cd ${options.cwd} && exec "$@"`, '--', command, ...args];
    } else if (options?.env) {
      const envPairs = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);
      cmd = ['env', ...envPairs, command, ...args];
    } else {
      cmd = [command, ...args];
    }

    const execPromise = this.adapter.execInSandbox(this.sessionId, cmd);

    if (options?.timeoutMs != null) {
      const timeoutPromise = new Promise<ExecResult>((resolve) => {
        setTimeout(() => {
          resolve({ exitCode: 124, stdout: '', stderr: 'Command timed out', timedOut: true });
        }, options.timeoutMs!);
      });
      return Promise.race([execPromise, timeoutPromise]);
    }

    return execPromise;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      await this.adapter.stopSandbox(this.sessionId);
    } catch {
      // Ignore stop errors
    }
    try {
      await this.adapter.destroySandbox(this.sessionId);
    } catch {
      // Ignore destroy errors
    }
  }
}

/**
 * KataProvider implements the canonical IsolationProvider contract using Kata Containers.
 * Translates IsolationPolicy to KataSessionConfig and delegates lifecycle
 * operations to a KataAdapter.
 */
export class KataProvider implements IsolationProvider {
  readonly name = 'kata';
  private readonly adapter: KataAdapter;

  constructor(adapter: KataAdapter = new StubKataAdapter()) {
    this.adapter = adapter;
  }

  capabilities(): IsolationCapabilities {
    return {
      mounts: false,
      networkModes: ['none', 'full'],
      envAllowlist: false,
      secrets: false,
      resources: true,
    };
  }

  async healthCheck(): Promise<IsolationProviderHealthCheckResult> {
    if (typeof this.adapter.healthCheck !== 'function') {
      return { healthy: true, message: 'Adapter does not support health checks (assumed healthy)' };
    }
    try {
      const result = await this.adapter.healthCheck();
      if (result.healthy) {
        return { healthy: true, message: 'Kata runtime reachable', details: { version: result.version } };
      }
      return { healthy: false, message: 'Kata runtime not reachable' };
    } catch {
      return { healthy: false, message: 'Kata runtime health check failed' };
    }
  }

  /**
   * Translate the policy and create a new Kata sandbox session.
   * Throws CapabilityMismatchError if the policy contains unsupported fields.
   */
  async createSession(policy: IsolationPolicy): Promise<IsolationSession> {
    const config = translatePolicy(policy);
    const sessionId = randomUUID();
    await this.adapter.createSandbox(sessionId, config);
    return new KataSession(sessionId, this.adapter);
  }
}
