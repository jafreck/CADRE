import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import type { AgentInvocation, AgentResult } from './types.js';
import { spawnProcess, stripVSCodeEnv, trackProcess, type ProcessResult } from '../util/process.js';
import { exists, ensureDir } from '../util/fs.js';
import { Logger } from '../logging/logger.js';

/** Interface for agent execution backends. */
export interface AgentBackend {
  /** Unique backend name. */
  name: string;
  /** Validate prerequisites (CLI availability, etc.). */
  init(): Promise<void>;
  /** Invoke an agent and return the result. */
  invoke(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult>;
}

/**
 * Shared helper: build environment variables for an agent process.
 */
function buildEnv(
  invocation: AgentInvocation,
  worktreePath: string,
  config: CadreConfig,
): Record<string, string | undefined> {
  let env = { ...process.env };

  env = stripVSCodeEnv(env);

  env['CADRE_ISSUE_NUMBER'] = String(invocation.issueNumber);
  env['CADRE_WORKTREE_PATH'] = worktreePath;
  env['CADRE_PHASE'] = String(invocation.phase);
  if (invocation.taskId) {
    env['CADRE_TASK_ID'] = invocation.taskId;
  }

  if (config.environment.extraPath.length > 0) {
    const separator = process.platform === 'win32' ? ';' : ':';
    env['PATH'] = [
      ...config.environment.extraPath,
      env['PATH'] ?? '',
    ].join(separator);
  }

  return env;
}

/**
 * Shared helper: parse total token usage from agent output.
 * Tries multiple formats including JSON (Claude CLI) and plain text patterns.
 */
function parseTokenUsage(result: ProcessResult): number {
  // Try JSON output (Claude CLI --output-format json)
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    if (parsed['usage'] && typeof parsed['usage'] === 'object') {
      const usage = parsed['usage'] as Record<string, unknown>;
      const input = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
      const output = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;
      const cacheRead = typeof usage['cache_read_input_tokens'] === 'number' ? usage['cache_read_input_tokens'] : 0;
      const cacheCreate = typeof usage['cache_creation_input_tokens'] === 'number' ? usage['cache_creation_input_tokens'] : 0;
      return input + output + cacheRead + cacheCreate;
    }
  } catch {
    // Not JSON — fall through to text patterns
  }

  const combined = result.stdout + result.stderr;
  const patterns = [
    /total[_\s]?tokens?[:\s]+(\d[\d,]*)/i,
    /tokens?[_\s]?used[:\s]+(\d[\d,]*)/i,
    /usage[:\s]+(\d[\d,]*)\s*tokens?/i,
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
  }

  return 0;
}

/**
 * Shared helper: write a structured log file for an agent invocation.
 */
async function writeAgentLog(
  logFile: string,
  invocation: AgentInvocation,
  startTime: number,
  processResult: ProcessResult,
): Promise<void> {
  try {
    const logContent = [
      `=== Agent: ${invocation.agent} ===`,
      `=== Issue: #${invocation.issueNumber} ===`,
      `=== Phase: ${invocation.phase} ===`,
      invocation.taskId ? `=== Task: ${invocation.taskId} ===` : '',
      `=== Started: ${new Date(startTime).toISOString()} ===`,
      `=== Duration: ${Date.now() - startTime}ms ===`,
      `=== Exit Code: ${processResult.exitCode} ===`,
      `=== Timed Out: ${processResult.timedOut} ===`,
      '',
      '--- STDOUT ---',
      processResult.stdout,
      '',
      '--- STDERR ---',
      processResult.stderr,
    ]
      .filter(Boolean)
      .join('\n');
    await writeFile(logFile, logContent, 'utf-8');
  } catch {
    // Best-effort log writing
  }
}

/**
 * Backend that invokes agents via the GitHub Copilot CLI.
 */
export class CopilotBackend implements AgentBackend {
  readonly name = 'copilot';

  private readonly cliCommand: string;
  private readonly agentDir: string;
  private readonly defaultTimeout: number;
  private readonly defaultModel: string | undefined;

  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {
    // Prefer config.agent.copilot settings, fall back to legacy config.copilot
    this.cliCommand = config.agent?.copilot?.cliCommand ?? config.copilot.cliCommand;
    this.agentDir = config.agent?.copilot?.agentDir ?? config.copilot.agentDir;
    this.defaultTimeout = config.agent?.timeout ?? config.copilot.timeout;
    this.defaultModel = config.agent?.model ?? config.copilot.model;
  }

  async init(): Promise<void> {
    this.logger.debug(`CopilotBackend initialized (cli: ${this.cliCommand})`);
  }

  async invoke(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult> {
    const startTime = Date.now();
    const logDir = join(worktreePath, '.cadre', 'issues', String(invocation.issueNumber), 'logs');
    await ensureDir(logDir);

    const timestamp = Date.now();
    const taskSuffix = invocation.taskId ? `-${invocation.taskId}` : '';
    const logFile = join(logDir, `${invocation.agent}${taskSuffix}-${timestamp}.log`);

    this.logger.info(`Launching agent (copilot): ${invocation.agent}`, {
      issueNumber: invocation.issueNumber,
      phase: invocation.phase,
      taskId: invocation.taskId,
    });

    const prompt = `Read your context file at: ${invocation.contextPath}`;

    const args = [
      '--agent', invocation.agent,
      '-p', prompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-ask-user',
      '-s',
    ];

    if (this.defaultModel) {
      args.push('--model', this.defaultModel);
    }

    const env = buildEnv(invocation, worktreePath, this.config);
    const timeout = invocation.timeout ?? this.defaultTimeout;
    const { promise, process: child } = spawnProcess(this.cliCommand, args, {
      cwd: worktreePath,
      env,
      timeout,
    });

    trackProcess(child);
    const processResult = await promise;

    await writeAgentLog(logFile, invocation, startTime, processResult);

    const tokenUsage = parseTokenUsage(processResult);
    const outputExists = await exists(invocation.outputPath);
    const duration = Date.now() - startTime;
    const success = processResult.exitCode === 0 && !processResult.timedOut;

    if (success) {
      this.logger.info(`Agent ${invocation.agent} completed in ${duration}ms`, {
        issueNumber: invocation.issueNumber,
        phase: invocation.phase,
        taskId: invocation.taskId,
        data: { tokenUsage, outputExists },
      });
    } else {
      this.logger.error(`Agent ${invocation.agent} failed (exit: ${processResult.exitCode}, timeout: ${processResult.timedOut})`, {
        issueNumber: invocation.issueNumber,
        phase: invocation.phase,
        taskId: invocation.taskId,
        data: { stderr: processResult.stderr.slice(0, 500) },
      });
    }

    return {
      agent: invocation.agent,
      success,
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      duration,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      tokenUsage,
      outputPath: invocation.outputPath,
      outputExists,
      error: success ? undefined : processResult.stderr || `Exit code: ${processResult.exitCode}`,
    };
  }
}

/**
 * Backend that invokes agents via the Anthropic Claude CLI.
 */
export class ClaudeBackend implements AgentBackend {
  readonly name = 'claude';

  private readonly cliCommand: string;
  private readonly defaultTimeout: number;
  private readonly defaultModel: string | undefined;

  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {
    this.cliCommand = config.agent?.claude?.cliCommand ?? 'claude';
    this.defaultTimeout = config.agent?.timeout ?? config.copilot.timeout;
    this.defaultModel = config.agent?.model;
  }

  async init(): Promise<void> {
    this.logger.debug(`ClaudeBackend initialized (cli: ${this.cliCommand})`);
  }

  async invoke(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult> {
    const startTime = Date.now();
    const logDir = join(worktreePath, '.cadre', 'issues', String(invocation.issueNumber), 'logs');
    await ensureDir(logDir);

    const timestamp = Date.now();
    const taskSuffix = invocation.taskId ? `-${invocation.taskId}` : '';
    const logFile = join(logDir, `${invocation.agent}${taskSuffix}-${timestamp}.log`);

    this.logger.info(`Launching agent (claude): ${invocation.agent}`, {
      issueNumber: invocation.issueNumber,
      phase: invocation.phase,
      taskId: invocation.taskId,
    });

    const prompt = `Read your context file at: ${invocation.contextPath}`;

    const args = [
      '-p', prompt,
      '--allowedTools', 'Bash,Read,Write,Edit,MultiEdit,Glob,Grep,TodoRead,TodoWrite,mcp__*',
      '--output-format', 'json',
    ];

    if (this.defaultModel) {
      args.push('--model', this.defaultModel);
    }

    const env = buildEnv(invocation, worktreePath, this.config);
    const timeout = invocation.timeout ?? this.defaultTimeout;
    const { promise, process: child } = spawnProcess(this.cliCommand, args, {
      cwd: worktreePath,
      env,
      timeout,
    });

    trackProcess(child);
    const processResult = await promise;

    await writeAgentLog(logFile, invocation, startTime, processResult);

    const tokenUsage = parseTokenUsage(processResult);
    const outputExists = await exists(invocation.outputPath);
    const duration = Date.now() - startTime;
    const success = processResult.exitCode === 0 && !processResult.timedOut;

    if (success) {
      this.logger.info(`Agent ${invocation.agent} completed in ${duration}ms`, {
        issueNumber: invocation.issueNumber,
        phase: invocation.phase,
        taskId: invocation.taskId,
        data: { tokenUsage, outputExists },
      });
    } else {
      this.logger.error(`Agent ${invocation.agent} failed (exit: ${processResult.exitCode}, timeout: ${processResult.timedOut})`, {
        issueNumber: invocation.issueNumber,
        phase: invocation.phase,
        taskId: invocation.taskId,
        data: { stderr: processResult.stderr.slice(0, 500) },
      });
    }

    return {
      agent: invocation.agent,
      success,
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      duration,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      tokenUsage,
      outputPath: invocation.outputPath,
      outputExists,
      error: success ? undefined : processResult.stderr || `Exit code: ${processResult.exitCode}`,
    };
  }
}
