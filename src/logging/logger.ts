import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { format } from 'date-fns';
import type { LogLevel, LogEntry, CadreEvent } from './events.js';

export interface LoggerOptions {
  /** Base directory for log files. */
  logDir: string;
  /** Minimum log level to output. */
  level: LogLevel;
  /** Whether to also print to console. */
  console: boolean;
  /** Source identifier for this logger instance. */
  source: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly opts: LoggerOptions;
  private readonly logFile: string;
  private initPromise: Promise<unknown> | null = null;

  constructor(opts: Partial<LoggerOptions> & { source: string }) {
    this.opts = {
      logDir: opts.logDir ?? join(homedir(), '.cadre', 'logs'),
      level: opts.level ?? 'info',
      console: opts.console ?? true,
      source: opts.source,
    };
    this.logFile = join(this.opts.logDir, `${this.opts.source}.log`);
  }

  private async ensureDir(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = mkdir(dirname(this.logFile), { recursive: true });
    }
    await this.initPromise;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.opts.level];
  }

  private formatConsole(entry: LogEntry): string {
    const ts = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
    const levelTag = entry.level.toUpperCase().padEnd(5);
    const ctx = [
      entry.issueNumber != null ? `#${entry.issueNumber}` : null,
      entry.phase != null ? `P${entry.phase}` : null,
      entry.taskId ?? null,
    ]
      .filter(Boolean)
      .join(' ');
    const ctxStr = ctx ? ` [${ctx}]` : '';
    return `${ts} ${levelTag} [${entry.source}]${ctxStr} ${entry.message}`;
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    if (!this.shouldLog(entry.level)) return;

    if (this.opts.console) {
      const formatted = this.formatConsole(entry);
      if (entry.level === 'error') {
        console.error(formatted);
      } else if (entry.level === 'warn') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }

    try {
      await this.ensureDir();
      const line = JSON.stringify(entry) + '\n';
      await appendFile(this.logFile, line, 'utf-8');
    } catch {
      // Swallow file write errors to avoid cascading failures
    }
  }

  private buildEntry(
    level: LogLevel,
    message: string,
    context?: { issueNumber?: number; phase?: number; taskId?: string; sessionId?: string; data?: Record<string, unknown> },
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      source: this.opts.source,
      message,
      ...context,
    };
  }

  debug(message: string, context?: { issueNumber?: number; phase?: number; taskId?: string; sessionId?: string; data?: Record<string, unknown> }): void {
    void this.writeEntry(this.buildEntry('debug', message, context));
  }

  info(message: string, context?: { issueNumber?: number; phase?: number; taskId?: string; sessionId?: string; data?: Record<string, unknown> }): void {
    void this.writeEntry(this.buildEntry('info', message, context));
  }

  warn(message: string, context?: { issueNumber?: number; phase?: number; taskId?: string; sessionId?: string; data?: Record<string, unknown> }): void {
    void this.writeEntry(this.buildEntry('warn', message, context));
  }

  error(message: string, context?: { issueNumber?: number; phase?: number; taskId?: string; sessionId?: string; data?: Record<string, unknown> }): void {
    void this.writeEntry(this.buildEntry('error', message, context));
  }

  /**
   * Log a structured event.
   */
  event(event: CadreEvent, level: LogLevel = 'info'): void {
    void this.writeEntry(
      this.buildEntry(level, event.type, {
        data: event as unknown as Record<string, unknown>,
      }),
    );
  }

  /**
   * Create a child logger with an issue-specific context and log file.
   */
  child(issueNumber: number, logDir?: string): Logger {
    return new Logger({
      logDir: logDir ?? this.opts.logDir,
      level: this.opts.level,
      console: this.opts.console,
      source: `issue-${issueNumber}`,
    });
  }

  /**
   * Create an agent-specific logger.
   */
  agentLogger(agentName: string, issueNumber: number, logDir: string): Logger {
    return new Logger({
      logDir,
      level: 'debug', // Always capture full debug for agent logs
      console: false,  // Agent logs go to file only
      source: agentName,
    });
  }
}
