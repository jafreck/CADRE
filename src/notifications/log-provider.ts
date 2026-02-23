import { appendFile } from 'fs/promises';
import path from 'path';
import type { NotificationProvider } from './types.js';
import type { CadreEvent } from '../logging/events.js';

export interface LogProviderConfig {
  logFile?: string;
  events?: string[];
}

export class LogProvider implements NotificationProvider {
  private readonly logFile: string;
  private readonly events?: string[];

  constructor(config: LogProviderConfig = {}) {
    this.logFile = config.logFile ?? path.join(process.cwd(), '.cadre', 'notifications.jsonl');
    this.events = config.events;
  }

  async notify(event: CadreEvent): Promise<void> {
    if (this.events && !this.events.includes(event.type)) {
      return;
    }

    const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n';

    try {
      await appendFile(this.logFile, line, { flag: 'a' });
    } catch (err) {
      console.error('[LogProvider] Failed to write notification:', err);
    }
  }
}
