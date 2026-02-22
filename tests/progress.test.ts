import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetProgressWriter, IssueProgressWriter } from '../src/core/progress.js';
import type { IssueProgressInfo } from '../src/core/progress.js';
import { Logger } from '../src/logging/logger.js';
import type { PhaseResult } from '../src/agents/types.js';

function makeMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('FleetProgressWriter', () => {
  let tempDir: string;
  let logger: Logger;

  beforeEach(async () => {
    logger = makeMockLogger();
    tempDir = join(tmpdir(), `cadre-progress-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeIssue(overrides: Partial<IssueProgressInfo> = {}): IssueProgressInfo {
    return {
      issueNumber: 1,
      issueTitle: 'Test Issue',
      status: 'not-started',
      currentPhase: 0,
      totalPhases: 5,
      ...overrides,
    };
  }

  it('should emit 💸 emoji for budget-exceeded status', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'budget-exceeded' }),
    ];

    await writer.write(issues, [], { current: 1000 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('💸 budget-exceeded');
  });

  it('should count budget-exceeded issues in fleet summary', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'completed' }),
      makeIssue({ issueNumber: 2, status: 'budget-exceeded' }),
      makeIssue({ issueNumber: 3, status: 'budget-exceeded' }),
    ];

    await writer.write(issues, [], { current: 5000 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('2 budget-exceeded');
    expect(content).toContain('1 completed');
  });

  it('should show 0 budget-exceeded when none present', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'completed' }),
      makeIssue({ issueNumber: 2, status: 'failed' }),
    ];

    await writer.write(issues, [], { current: 500 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('0 budget-exceeded');
  });

  it('should include all statuses in fleet summary line', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'completed' }),
      makeIssue({ issueNumber: 2, status: 'in-progress' }),
      makeIssue({ issueNumber: 3, status: 'failed' }),
      makeIssue({ issueNumber: 4, status: 'blocked' }),
      makeIssue({ issueNumber: 5, status: 'not-started' }),
      makeIssue({ issueNumber: 6, status: 'budget-exceeded' }),
    ];

    await writer.write(issues, [], { current: 2000 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('6 total');
    expect(content).toContain('1 completed');
    expect(content).toContain('1 in-progress');
    expect(content).toContain('1 failed');
    expect(content).toContain('1 blocked');
    expect(content).toContain('1 not-started');
    expect(content).toContain('1 budget-exceeded');
  });

  it('should show correct emojis for all statuses', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'not-started' }),
      makeIssue({ issueNumber: 2, status: 'in-progress' }),
      makeIssue({ issueNumber: 3, status: 'completed' }),
      makeIssue({ issueNumber: 4, status: 'failed' }),
      makeIssue({ issueNumber: 5, status: 'blocked' }),
      makeIssue({ issueNumber: 6, status: 'budget-exceeded' }),
    ];

    await writer.write(issues, [], { current: 100 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('⏳ not-started');
    expect(content).toContain('🔄 in-progress');
    expect(content).toContain('✅ completed');
    expect(content).toContain('❌ failed');
    expect(content).toContain('🚫 blocked');
    expect(content).toContain('💸 budget-exceeded');
  });

  it('should display token usage with budget', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    await writer.write([], [], { current: 5000, budget: 10000 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('5,000 / 10,000');
  });

  it('should include PR links in the issues table', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 42, status: 'completed', prNumber: 99 }),
    ];

    await writer.write(issues, [{ issueNumber: 42, prNumber: 99, url: 'http://example.com/99' }], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('#99');
    expect(content).toContain('1');
  });

  it('should append events when present', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    await writer.appendEvent('Issue #1 started');
    await writer.write([], [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('Issue #1 started');
    expect(content).toContain('Event Log');
  });
});

describe('IssueProgressInfo status type', () => {
  it('should accept budget-exceeded as a valid status', () => {
    const info: IssueProgressInfo = {
      issueNumber: 7,
      issueTitle: 'Budget issue',
      status: 'budget-exceeded',
      currentPhase: 2,
      totalPhases: 5,
    };
    expect(info.status).toBe('budget-exceeded');
  });
});
