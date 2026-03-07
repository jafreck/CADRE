import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { LogLevel, LogEntry, RuntimeEvent } from './events.js';

export interface LoggerOptions {
  logDir: string;
  level: LogLevel;
  console: boolean;
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
    const ts = entry.timestamp.slice(11, 23);
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

  private pendingWrites: Promise<unknown>[] = [];

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

    const writePromise = (async () => {
      try {
        await this.ensureDir();
        const line = JSON.stringify(entry) + '\n';
        await appendFile(this.logFile, line, 'utf-8');
      } catch {
      }
    })();
    this.pendingWrites.push(writePromise);
    // Clean up resolved promises to avoid unbounded growth
    writePromise.finally(() => {
      const idx = this.pendingWrites.indexOf(writePromise);
      if (idx >= 0) this.pendingWrites.splice(idx, 1);
    });
  }

  /**
   * Flush all pending log writes. Call before process exit to avoid data loss.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
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

  event(event: RuntimeEvent, level: LogLevel = 'info'): void {
    void this.writeEntry(
      this.buildEntry(level, event.type, {
        data: event as unknown as Record<string, unknown>,
      }),
    );
  }

  child(issueNumber: number, logDir?: string): Logger {
    return new Logger({
      logDir: logDir ?? this.opts.logDir,
      level: this.opts.level,
      console: this.opts.console,
      source: `issue-${issueNumber}`,
    });
  }

  agentLogger(agentName: string, issueNumber: number, logDir: string): Logger {
    return new Logger({
      logDir,
      level: 'debug',
      console: false,
      source: agentName,
    });
  }
}
