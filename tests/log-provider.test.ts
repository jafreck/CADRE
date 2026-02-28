import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LogProvider } from '../src/notifications/log-provider.js';

vi.mock('fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

import { appendFile } from 'fs/promises';
const mockAppendFile = appendFile as unknown as ReturnType<typeof vi.fn>;

describe('LogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendFile.mockResolvedValue(undefined);
  });

  it('should append a JSONL line to the default log file', async () => {
    const provider = new LogProvider();
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath, content] = mockAppendFile.mock.calls[0];
    expect(filePath).toBe(join(homedir(), '.cadre', 'notifications.jsonl'));
    expect(content).toMatch(/^\{.*\}\n$/);
  });

  it('should append a JSONL line to a custom log file', async () => {
    const provider = new LogProvider({ logFile: '/tmp/custom.jsonl' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [filePath] = mockAppendFile.mock.calls[0];
    expect(filePath).toBe('/tmp/custom.jsonl');
  });

  it('should include event fields and a timestamp in the written JSON', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl' });
    await provider.notify({ type: 'issue-started', issueNumber: 42, issueTitle: 'Fix bug', worktreePath: '/tmp/wt' });
    const [, content] = mockAppendFile.mock.calls[0];
    const parsed = JSON.parse((content as string).trim());
    expect(parsed.type).toBe('issue-started');
    expect(parsed.issueNumber).toBe(42);
    expect(parsed.issueTitle).toBe('Fix bug');
    expect(typeof parsed.timestamp).toBe('string');
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });

  it('should end each line with a newline character', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, content] = mockAppendFile.mock.calls[0];
    expect((content as string).endsWith('\n')).toBe(true);
  });

  it('should skip events not in the events filter', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl', events: ['issue-completed'] });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it('should write events matching the events filter', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl', events: ['fleet-started'] });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockAppendFile).toHaveBeenCalledOnce();
  });

  it('should write all events when no filter is configured', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    await provider.notify({ type: 'fleet-completed', success: true, prsCreated: 0, failedIssues: 0, totalDuration: 10, totalTokens: 100 });
    expect(mockAppendFile).toHaveBeenCalledTimes(2);
  });

  it('should not throw when appendFile rejects', async () => {
    mockAppendFile.mockRejectedValue(new Error('disk full'));
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl' });
    await expect(provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 })).resolves.toBeUndefined();
  });

  it('should use append flag when writing', async () => {
    const provider = new LogProvider({ logFile: '/tmp/test.jsonl' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, , options] = mockAppendFile.mock.calls[0];
    expect((options as { flag?: string }).flag).toBe('a');
  });
});
