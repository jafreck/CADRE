import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import type { AgentInvocation, AgentResult, AgentName } from '../agents/types.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';
import { spawnProcess, stripVSCodeEnv, trackProcess, type ProcessResult } from '../util/process.js';
import { exists, ensureDir, statOrNull } from '../util/fs.js';
import { Logger } from '../logging/logger.js';

/**
 * Spawns agent invocations as headless child processes via the Copilot CLI.
 */
export class AgentLauncher {
  private cliCommand: string;
  private agentDir: string;
  private defaultTimeout: number;

  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {
    this.cliCommand = config.copilot.cliCommand;
    this.agentDir = config.copilot.agentDir;
    this.defaultTimeout = config.copilot.timeout;
  }

  /**
   * Validate that all agent instruction files exist and are non-empty.
   * Returns an array of error strings for any missing or empty files.
   */
  static async validateAgentFiles(agentDir: string): Promise<string[]> {
    const resolvedDir = resolve(agentDir);
    const issues: string[] = [];
    for (const agent of AGENT_DEFINITIONS) {
      const filePath = join(resolvedDir, `${agent.name}.md`);
      const fileStat = await statOrNull(filePath);
      if (fileStat === null) {
        issues.push(`  ❌ Missing: ${filePath}`);
      } else if (fileStat.size === 0) {
        issues.push(`  ❌ Empty:   ${filePath}`);
      }
    }
    return issues;
  }

  /**
   * Validate that the CLI command is available.
   */
  async init(): Promise<void> {
    this.logger.debug(`Agent launcher initialized (cli: ${this.cliCommand})`);
  }

  /**
   * Launch an agent in the context of a specific worktree.
   */
  async launchAgent(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult> {
    const startTime = Date.now();
    const logDir = join(worktreePath, '.cadre', 'issues', String(invocation.issueNumber), 'logs');
    await ensureDir(logDir);

    const timestamp = Date.now();
    const taskSuffix = invocation.taskId ? `-${invocation.taskId}` : '';
    const logFile = join(logDir, `${invocation.agent}${taskSuffix}-${timestamp}.log`);

    this.logger.info(`Launching agent: ${invocation.agent}`, {
      issueNumber: invocation.issueNumber,
      phase: invocation.phase,
      taskId: invocation.taskId,
    });

    // Build the prompt
    const prompt = `Read your context file at: ${invocation.contextPath}`;

    // Build CLI command args
    const args = [
      '--agent', invocation.agent,
      '-p', prompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-ask-user',
      '-s',
    ];

    // Add model if configured
    if (this.config.copilot.model) {
      args.push('--model', this.config.copilot.model);
    }

    // Build environment
    const env = this.buildEnv(invocation, worktreePath);

    // Spawn the process
    const timeout = invocation.timeout ?? this.defaultTimeout;
    const { promise, process: child } = spawnProcess(this.cliCommand, args, {
      cwd: worktreePath,
      env,
      timeout,
    });

    trackProcess(child);

    // Wait for completion
    const processResult = await promise;

    // Write log file
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

    // Parse token usage from output
    const tokenUsage = this.parseTokenUsage(processResult);

    // Check if output exists
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

  /**
   * Build environment variables for the agent process.
   */
  private buildEnv(
    invocation: AgentInvocation,
    worktreePath: string,
  ): Record<string, string | undefined> {
    let env = { ...process.env };

    // Strip VS Code IPC variables
    env = stripVSCodeEnv(env);

    // Add CADRE-specific env vars
    env['CADRE_ISSUE_NUMBER'] = String(invocation.issueNumber);
    env['CADRE_WORKTREE_PATH'] = worktreePath;
    env['CADRE_PHASE'] = String(invocation.phase);
    if (invocation.taskId) {
      env['CADRE_TASK_ID'] = invocation.taskId;
    }

    // Handle PATH
    if (this.config.environment.inheritShellPath) {
      // Keep existing PATH
    }
    if (this.config.environment.extraPath.length > 0) {
      const separator = process.platform === 'win32' ? ';' : ':';
      env['PATH'] = [
        ...this.config.environment.extraPath,
        env['PATH'] ?? '',
      ].join(separator);
    }

    return env;
  }

  /**
   * Parse token usage from agent output.
   * Agents may report usage in various formats.
   */
  private parseTokenUsage(result: ProcessResult): number {
    const combined = result.stdout + result.stderr;

    // Try to find token usage in various formats
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
}
