import { randomUUID } from 'node:crypto';
import type {
  ExecOptions,
  ExecResult,
  IsolationCapabilities,
  IsolationPolicy,
  IsolationProvider,
  IsolationSession,
} from '@cadre/agent-runtime';
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
}

/** IsolationSession backed by a Kata sandbox. */
class KataSession implements IsolationSession {
  readonly sessionId: string;
  private readonly adapter: KataAdapter;

  constructor(sessionId: string, adapter: KataAdapter) {
    this.sessionId = sessionId;
    this.adapter = adapter;
  }

  async exec(command: string, args: string[], _options?: ExecOptions): Promise<ExecResult> {
    const result = await this.adapter.execInSandbox(this.sessionId, [command, ...args]);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async destroy(): Promise<void> {
    await this.adapter.destroySandbox(this.sessionId);
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
