import { execFile } from 'node:child_process';
import type { KataAdapter } from './kata-provider.js';
import type { KataSessionConfig } from './types.js';

export interface DockerKataAdapterOptions {
  /** Container image to use (e.g., 'alpine:3') */
  image: string;
  /** Inject a custom command runner for testing; defaults to real execFile */
  runner?: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

function createDefaultRunner(): (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return (args: string[]) =>
    new Promise((resolve) => {
      execFile('docker', args, (error, stdout, stderr) => {
        const exitCode = error != null ? 1 : 0;
        resolve({ exitCode, stdout, stderr });
      });
    });
}

export class DockerKataAdapter implements KataAdapter {
  private readonly image: string;
  private readonly runner: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

  constructor(opts: DockerKataAdapterOptions) {
    this.image = opts.image;
    this.runner = opts.runner ?? createDefaultRunner();
  }

  async createSandbox(sessionId: string, config: KataSessionConfig): Promise<void> {
    const args = ['run', '-d', '--runtime', config.runtime, '--name', sessionId];

    if (config.networkIsolation) {
      args.push('--network', 'none');
    }
    if (config.memoryLimitBytes != null) {
      args.push('--memory', String(config.memoryLimitBytes));
    }
    if (config.cpuQuota != null) {
      args.push('--cpu-shares', String(config.cpuQuota));
    }
    if (config.readOnlyRootfs) {
      args.push('--read-only');
    }

    args.push(this.image, 'sleep', 'infinity');

    const result = await this.runner(args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Kata sandbox: ${result.stderr}`);
    }
  }

  async execInSandbox(
    sessionId: string,
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.runner(['exec', sessionId, ...command]);
  }

  async stopSandbox(sessionId: string): Promise<void> {
    try {
      await this.runner(['stop', sessionId]);
    } catch {
      // Ignore errors — container may already be stopped
    }
  }

  async destroySandbox(sessionId: string): Promise<void> {
    try {
      await this.runner(['rm', '--force', sessionId]);
    } catch {
      // Ignore errors — container may already be removed
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; version?: string }> {
    try {
      const result = await this.runner(['info', '--format', '{{.ServerVersion}}']);
      if (result.exitCode === 0) {
        return { healthy: true, version: result.stdout.trim() };
      }
      return { healthy: false };
    } catch {
      return { healthy: false };
    }
  }
}
