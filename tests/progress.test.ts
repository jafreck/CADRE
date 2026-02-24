import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetProgressWriter, IssueProgressWriter, phaseNames } from '../src/core/progress.js';
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

function makePhaseResult(overrides: Partial<PhaseResult> = {}): PhaseResult {
  return {
    phase: 1,
    phaseName: 'Analysis & Scouting',
    success: true,
    duration: 5000,
    tokenUsage: 100,
    ...overrides,
  };
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

  it('should emit ⚠️ emoji for code-complete status', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 10, status: 'code-complete', branch: 'cadre/issue-10' }),
    ];

    await writer.write(issues, [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('⚠️ code-complete');
  });

  it('should include Code Complete — PR Needed section when an issue has code-complete status', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 11, issueTitle: 'Fix auth bug', status: 'code-complete', branch: 'cadre/issue-11' }),
    ];

    await writer.write(issues, [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('## Code Complete — PR Needed');
    expect(content).toContain('#11 Fix auth bug');
    expect(content).toContain('cadre/issue-11');
  });

  it('should NOT include Code Complete — PR Needed section when no issues have code-complete status', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 1, status: 'completed' }),
      makeIssue({ issueNumber: 2, status: 'failed' }),
    ];

    await writer.write(issues, [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).not.toContain('## Code Complete — PR Needed');
  });

  it('should list all code-complete issues in the Code Complete section with their branch names', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 20, issueTitle: 'Issue A', status: 'code-complete', branch: 'cadre/issue-20' }),
      makeIssue({ issueNumber: 21, issueTitle: 'Issue B', status: 'code-complete', branch: 'cadre/issue-21' }),
      makeIssue({ issueNumber: 22, issueTitle: 'Issue C', status: 'completed' }),
    ];

    await writer.write(issues, [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('#20 Issue A');
    expect(content).toContain('cadre/issue-20');
    expect(content).toContain('#21 Issue B');
    expect(content).toContain('cadre/issue-21');
    // completed issue should not appear in the Code Complete section
    expect(content).not.toContain('#22 Issue C — branch');
  });

  it('should use "unknown" as branch name when branch is undefined for code-complete issues', async () => {
    const writer = new FleetProgressWriter(tempDir, logger);
    const issues: IssueProgressInfo[] = [
      makeIssue({ issueNumber: 30, issueTitle: 'No Branch', status: 'code-complete' }),
    ];

    await writer.write(issues, [], { current: 0 });

    const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
    expect(content).toContain('unknown');
  });
});

describe('phaseNames', () => {
  it('should be exported as a const array of 5 strings', () => {
    expect(Array.isArray(phaseNames)).toBe(true);
    expect(phaseNames).toHaveLength(5);
  });

  it('should contain the canonical phase names in order', () => {
    expect(phaseNames[0]).toBe('Analysis & Scouting');
    expect(phaseNames[1]).toBe('Planning');
    expect(phaseNames[2]).toBe('Implementation');
    expect(phaseNames[3]).toBe('Integration Verification');
    expect(phaseNames[4]).toBe('PR Composition');
  });

  it('should render all phase names in IssueProgressWriter output', async () => {
    const logger = makeMockLogger();
    const tempDir = join(tmpdir(), `cadre-phase-names-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    try {
      const writer = new IssueProgressWriter(tempDir, 1, 'Test', logger);
      await writer.write([], 1, [], 0);
      const content = await readFile(join(tempDir, 'progress.md'), 'utf-8');
      for (const name of phaseNames) {
        expect(content).toContain(name);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

  it('should accept code-complete as a valid status', () => {
    const info: IssueProgressInfo = {
      issueNumber: 8,
      issueTitle: 'Code complete issue',
      status: 'code-complete',
      currentPhase: 4,
      totalPhases: 5,
    };
    expect(info.status).toBe('code-complete');
  });
});

describe('IssueProgressWriter – Gate Results section', () => {
  let tempDir: string;
  let writer: IssueProgressWriter;
  let mockLogger: Logger;

  beforeEach(async () => {
    mockLogger = makeMockLogger();
    tempDir = join(tmpdir(), `cadre-progress-gate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    writer = new IssueProgressWriter(tempDir, 42, 'Test Issue', mockLogger);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readProgress(): Promise<string> {
    return readFile(join(tempDir, 'progress.md'), 'utf-8');
  }

  it('should NOT include a Gate Results section when no phases have gateResult', async () => {
    const phases = [makePhaseResult({ gateResult: undefined })];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).not.toContain('## Gate Results');
  });

  it('should include a Gate Results section when a phase has gateResult', async () => {
    const phases = [
      makePhaseResult({
        gateResult: { status: 'pass', warnings: [], errors: [] },
      }),
    ];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).toContain('## Gate Results');
  });

  it('should render ✅ emoji for a passing gate', async () => {
    const phases = [
      makePhaseResult({
        phase: 1,
        phaseName: 'Analysis & Scouting',
        gateResult: { status: 'pass', warnings: [], errors: [] },
      }),
    ];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).toContain('✅ pass');
    expect(content).toContain('Phase 1: Analysis & Scouting');
  });

  it('should render ⚠️ emoji for a warning gate', async () => {
    const phases = [
      makePhaseResult({
        phase: 2,
        phaseName: 'Planning',
        gateResult: { status: 'warn', warnings: ['low coverage'], errors: [] },
      }),
    ];
    await writer.write(phases, 2, [], 0);

    const content = await readProgress();
    expect(content).toContain('⚠️ warn');
    expect(content).toContain('Phase 2: Planning');
  });

  it('should render ❌ emoji for a failing gate', async () => {
    const phases = [
      makePhaseResult({
        phase: 3,
        phaseName: 'Implementation',
        gateResult: { status: 'fail', warnings: [], errors: ['build failed'] },
      }),
    ];
    await writer.write(phases, 3, [], 0);

    const content = await readProgress();
    expect(content).toContain('❌ fail');
    expect(content).toContain('Phase 3: Implementation');
  });

  it('should list errors prefixed with ❌ under the phase', async () => {
    const phases = [
      makePhaseResult({
        gateResult: {
          status: 'fail',
          warnings: [],
          errors: ['build failed', 'type error in foo.ts'],
        },
      }),
    ];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).toContain('- ❌ build failed');
    expect(content).toContain('- ❌ type error in foo.ts');
  });

  it('should list warnings prefixed with ⚠️ under the phase', async () => {
    const phases = [
      makePhaseResult({
        gateResult: {
          status: 'warn',
          warnings: ['low coverage', 'slow test detected'],
          errors: [],
        },
      }),
    ];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).toContain('- ⚠️ low coverage');
    expect(content).toContain('- ⚠️ slow test detected');
  });

  it('should render gate results for multiple phases', async () => {
    const phases = [
      makePhaseResult({
        phase: 1,
        phaseName: 'Analysis & Scouting',
        gateResult: { status: 'pass', warnings: [], errors: [] },
      }),
      makePhaseResult({
        phase: 2,
        phaseName: 'Planning',
        gateResult: { status: 'warn', warnings: ['missing test'], errors: [] },
      }),
    ];
    await writer.write(phases, 2, [], 0);

    const content = await readProgress();
    expect(content).toContain('Phase 1: Analysis & Scouting');
    expect(content).toContain('Phase 2: Planning');
    expect(content).toContain('✅ pass');
    expect(content).toContain('⚠️ warn');
    expect(content).toContain('- ⚠️ missing test');
  });

  it('should render both errors and warnings in the same phase section', async () => {
    const phases = [
      makePhaseResult({
        gateResult: {
          status: 'fail',
          warnings: ['coverage below threshold'],
          errors: ['lint failed'],
        },
      }),
    ];
    await writer.write(phases, 1, [], 0);

    const content = await readProgress();
    expect(content).toContain('- ❌ lint failed');
    expect(content).toContain('- ⚠️ coverage below threshold');
  });

  it('should omit Gate Results section for phases without gateResult even when other phases have it', async () => {
    const phases = [
      makePhaseResult({ phase: 1, phaseName: 'Analysis & Scouting', gateResult: undefined }),
      makePhaseResult({
        phase: 2,
        phaseName: 'Planning',
        gateResult: { status: 'pass', warnings: [], errors: [] },
      }),
    ];
    await writer.write(phases, 2, [], 0);

    const content = await readProgress();
    expect(content).toContain('Phase 2: Planning');
    // Phase 1 should not appear in Gate Results since it has no gateResult
    expect(content).not.toContain('Phase 1: Analysis & Scouting — ');
  });
});
