import { execFile } from 'node:child_process';
import type {
  ExecResult,
  IsolationCapabilities,
  IsolationPolicy,
  IsolationProvider,
  IsolationSession,
} from '@cadre/agent-runtime';
import { DockerSession, type DockerRunner } from './docker-session.js';

export interface DockerProviderOptions {
  /** Docker image to use for sessions */
  image: string;
  /** Host path to mount as /workspace inside the container */
  worktreePath?: string;
  /** Inject a custom runner for testing */
  runner?: DockerRunner;
  /** Host environment source for allowlist filtering; defaults to process.env */
  hostEnv?: Record<string, string | undefined>;
}

function createDefaultRunner(): DockerRunner {
  return (args: string[]): Promise<ExecResult> =>
    new Promise((resolve) => {
      execFile('docker', args, (error, stdout, stderr) => {
        const exitCode =
          error != null
            ? typeof (error as NodeJS.ErrnoException).code === 'number'
              ? Number((error as NodeJS.ErrnoException).code)
              : 1
            : 0;
        resolve({ exitCode, stdout, stderr });
      });
    });
}

export class DockerProvider implements IsolationProvider {
  readonly name = 'docker';

  constructor(private readonly opts: DockerProviderOptions) {}

  capabilities(): IsolationCapabilities {
    return {
      mounts: true,
      networkModes: ['none', 'allowlist', 'full'],
      envAllowlist: true,
      secrets: false,
      resources: true,
    };
  }

  async createSession(policy: IsolationPolicy): Promise<IsolationSession> {
    const runner = this.opts.runner ?? createDefaultRunner();
    const runArgs = this.buildRunArgs(policy);
    const result = await runner(runArgs);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to start Docker container: ${result.stderr}`);
    }
    const containerId = result.stdout.trim();
    return new DockerSession({ containerId, runner });
  }

  private buildRunArgs(policy: IsolationPolicy): string[] {
    const args = ['run', '-d', '--init'];

    // Network mode: 'none' -> --network none, 'allowlist'|'full' -> --network bridge
    if (policy.networkMode !== undefined) {
      const networkArg = policy.networkMode === 'none' ? 'none' : 'bridge';
      args.push('--network', networkArg);
    }

    // Resource limits
    const res = policy.resources;
    if (res !== undefined) {
      if (res.cpuShares !== undefined) args.push('--cpu-shares', String(res.cpuShares));
      if (res.memoryMb !== undefined) args.push('--memory', `${res.memoryMb}m`);
      if (res.pidsLimit !== undefined) args.push('--pids-limit', String(res.pidsLimit));
      if (res.ulimits !== undefined) {
        for (const ulimit of res.ulimits) {
          args.push('--ulimit', `${ulimit.type}=${ulimit.soft}:${ulimit.hard}`);
        }
      }
      if (res.timeoutMs !== undefined) {
        args.push('--stop-timeout', String(Math.ceil(res.timeoutMs / 1000)));
      }
    }

    // Mounts from policy
    if (policy.mounts !== undefined) {
      for (const mount of policy.mounts) {
        const mode = mount.readOnly ? 'ro' : 'rw';
        args.push('-v', `${mount.path}:${mount.path}:${mode}`);
      }
    }

    // Worktree mount at /workspace
    if (this.opts.worktreePath !== undefined) {
      args.push('-v', `${this.opts.worktreePath}:/workspace:rw`);
    }

    // Env allowlist: only forward variables explicitly permitted
    if (policy.envAllowlist !== undefined) {
      const hostEnv = this.opts.hostEnv ?? (process.env as Record<string, string | undefined>);
      for (const key of policy.envAllowlist) {
        const val = hostEnv[key];
        if (val !== undefined) {
          args.push('-e', `${key}=${val}`);
        }
      }
    }

    args.push(this.opts.image, 'sleep', 'infinity');
    return args;
  }
}
