import { spawnProcess } from '@cadre/command-diagnostics';
import type { IsolationSession, ExecOptions, ExecResult } from '@cadre/agent-runtime';

export class HostSession implements IsolationSession {
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    const { promise } = spawnProcess(command, args, {
      env: options?.env,
      cwd: options?.cwd,
      timeout: options?.timeoutMs,
    });
    const result = await promise;
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async destroy(): Promise<void> {
    // No-op: no container or external resource to clean up for host sessions.
  }
}
