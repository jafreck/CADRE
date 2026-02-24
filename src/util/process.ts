import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  shell?: string | boolean;
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

    if (opts.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after 5 seconds if still alive
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, opts.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        signal,
        timedOut,
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
      child.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
  }
  activeProcesses.clear();
}

export function getTrackedProcessCount(): number {
  return activeProcesses.size;
}
