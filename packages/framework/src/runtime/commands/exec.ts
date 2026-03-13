import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { platform } from 'node:os';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** Elapsed wall-clock time in milliseconds. */
  duration: number;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  shell?: string | boolean;
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * Strip VS Code IPC environment variables to ensure truly headless execution.
 */
export function stripVSCodeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const stripped = { ...env };
  const prefixes = [
    'VSCODE_',
    'ELECTRON_',
    'TERM_PROGRAM_VERSION',
    'ORIGINAL_XDG_CURRENT_DESKTOP',
  ];
  for (const key of Object.keys(stripped)) {
    if (prefixes.some(p => key.startsWith(p))) {
      delete stripped[key];
    }
  }
  return stripped;
}

/**
 * Spawn a child process and collect its output.
 * Returns a ProcessResult when the process exits or times out.
 */
export function spawnProcess(
  command: string,
  args: string[],
  opts: SpawnOpts = {},
): { promise: Promise<ProcessResult>; process: ChildProcess } {
  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: opts.shell,
    detached: true,
  };

  const child = spawn(command, args, spawnOpts);
  child.unref();

  const promise = new Promise<ProcessResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startTime = Date.now();

    if (opts.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        // Force kill after 5 seconds if still alive
        setTimeout(() => {
          if (!child.killed) {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }
        }, 5000);
      }, opts.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      opts.onData?.(chunk.toString('utf-8'), 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      opts.onData?.(chunk.toString('utf-8'), 'stderr');
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        signal,
        timedOut,
        duration: Date.now() - startTime,
      });
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: err.message,
        signal: null,
        timedOut,
        duration: Date.now() - startTime,
      });
    });
  });

  return { promise, process: child };
}

/**
 * Run a command and wait for the result. Convenience wrapper around spawnProcess.
 */
export async function exec(
  command: string,
  args: string[],
  opts: SpawnOpts = {},
): Promise<ProcessResult> {
  const { promise } = spawnProcess(command, args, opts);
  return promise;
}

/**
 * Run a shell command string (through the shell).
 */
export async function execShell(
  command: string,
  opts: Omit<SpawnOpts, 'shell'> = {},
): Promise<ProcessResult> {
  return exec(command, [], { ...opts, shell: true });
}

/**
 * Active child processes that need cleanup on shutdown.
 */
const activeProcesses = new Set<ChildProcess>();

export function trackProcess(child: ChildProcess): void {
  activeProcesses.add(child);
  child.on('close', () => activeProcesses.delete(child));
}

export function killAllTrackedProcesses(): void {
  for (const child of activeProcesses) {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }
  }
  activeProcesses.clear();
}

export function getTrackedProcessCount(): number {
  return activeProcesses.size;
}

/**
 * Resolve the login-shell environment by spawning `bash -lc 'env'`
 * (or `zsh -lc` on macOS). The result is cached after the first call.
 *
 * Useful alongside `stripVSCodeEnv` for normalizing the execution
 * environment when running from VS Code, containers, or CI.
 */
let _loginShellEnvCache: Record<string, string> | null = null;

export async function resolveLoginShellEnv(): Promise<Record<string, string>> {
  if (_loginShellEnvCache) return _loginShellEnvCache;

  const shell = platform() === 'darwin' ? 'zsh' : 'bash';
  const result = await exec(shell, ['-lc', 'env'], { timeout: 10_000 });

  const env: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }

  _loginShellEnvCache = env;
  return env;
}

/** Reset the cached login shell env (for testing). */
export function _resetLoginShellEnvCache(): void {
  _loginShellEnvCache = null;
}
