import type { ExecOptions, ExecResult, IsolationSession } from '@cadre/agent-runtime';

export type DockerRunner = (args: string[]) => Promise<ExecResult>;

export interface DockerSessionOptions {
  containerId: string;
  runner: DockerRunner;
}

export class DockerSession implements IsolationSession {
  readonly sessionId: string;
  private destroyed = false;

  constructor(private readonly opts: DockerSessionOptions) {
    this.sessionId = opts.containerId;
  }

  async exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    if (this.destroyed) {
      throw new Error(`DockerSession ${this.sessionId} has been destroyed`);
    }
    const execArgs = ['exec'];
    if (options?.cwd) execArgs.push('-w', options.cwd);
    if (options?.env) {
      for (const [key, val] of Object.entries(options.env)) {
        execArgs.push('-e', `${key}=${val}`);
      }
    }
    execArgs.push(this.opts.containerId, command, ...args);
    return this.opts.runner(execArgs);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      await this.opts.runner(['stop', this.opts.containerId]);
    } catch {
      // Ignore stop errors; container may already be stopped
    }
    try {
      await this.opts.runner(['rm', '--force', this.opts.containerId]);
    } catch {
      // Ignore rm errors; container may already be removed
    }
  }
}
