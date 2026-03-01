import { randomUUID } from "node:crypto";
import type { IsolationPolicy, IsolationProvider, KataSessionConfig } from "./types.js";
import { translatePolicy } from "./policy-translator.js";

/** Internal session state tracked by the provider. */
type SessionState = {
  config: KataSessionConfig;
  status: "running" | "stopped";
};

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
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async stopSandbox(_sessionId: string): Promise<void> {}

  async destroySandbox(_sessionId: string): Promise<void> {}
}

/**
 * KataProvider implements the IsolationProvider contract using Kata Containers.
 * Translates IsolationPolicy to KataSessionConfig and delegates lifecycle
 * operations to a KataAdapter.
 */
export class KataProvider implements IsolationProvider {
  private readonly adapter: KataAdapter;
  private readonly sessions = new Map<string, SessionState>();

  constructor(adapter: KataAdapter = new StubKataAdapter()) {
    this.adapter = adapter;
  }

  /**
   * Translate the policy and start a new Kata sandbox session.
   * Throws CapabilityMismatchError if the policy contains unsupported fields.
   */
  async startSession(policy: IsolationPolicy): Promise<string> {
    const config = translatePolicy(policy);
    const sessionId = randomUUID();
    await this.adapter.createSandbox(sessionId, config);
    this.sessions.set(sessionId, { config, status: "running" });
    return sessionId;
  }

  /** Execute a command in the given session and return stdout/stderr/exit code. */
  async exec(
    sessionId: string,
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Session not running: ${sessionId}`);
    }
    return this.adapter.execInSandbox(sessionId, command);
  }

  /** Gracefully stop the given session. */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await this.adapter.stopSandbox(sessionId);
    session.status = "stopped";
  }

  /** Forcefully destroy the session and release all resources. */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await this.adapter.destroySandbox(sessionId);
    this.sessions.delete(sessionId);
  }
}
