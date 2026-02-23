/**
 * End-to-end tests for the IssueOrchestrator pipeline.
 *
 * Uses real CheckpointManager + filesystem (os.tmpdir), MockPlatformProvider,
 * and an inline E2ELauncher that writes synthetic agent outputs without requiring
 * real git or network operations.
 *
 * Git operations (CommitManager) are fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { CheckpointManager } from '../src/core/checkpoint.js';
import { MockPlatformProvider } from './helpers/mock-platform-provider.js';
import { Logger } from '../src/logging/logger.js';
import { CadreConfigSchema } from '../src/config/schema.js';
import { ensureDir, exists } from '../src/util/fs.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { AgentInvocation, AgentResult } from '../src/agents/types.js';

// ── Module Mocks ──────────────────────────────────────────────────────────────

// Mock CommitManager to avoid real git operations in temp directories
vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    commit: vi.fn().mockResolvedValue('abc123'),
    commitFiles: vi.fn().mockResolvedValue('abc123'),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    isClean: vi.fn().mockResolvedValue(true),
    getDiff: vi.fn().mockResolvedValue(''),
    getTaskDiff: vi.fn().mockResolvedValue(''),
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue('abc123'),
  })),
}));

// Mock simple-git so ImplementationToIntegrationGate (gate 3) can compute a
// diff without a real git repository in the temp directory.
vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockReturnValue({
    diff: vi.fn().mockResolvedValue('diff --git a/src/core/change.ts b/src/core/change.ts\n+// implementation change'),
  }),
}));

// Mock execShell so Phase 4 integration verification can run build/test
// commands without actually executing them. This allows the integration
// report to include build/test sections (required by gate 4).
vi.mock('../src/util/process.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/util/process.js')>();
  return {
    ...original,
    execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'OK', stderr: '' }),
  };
});

// ── Synthetic Content ─────────────────────────────────────────────────────────

const SYNTHETIC_ANALYSIS = `# Analysis: Issue

## Requirements
- Implement the requested feature
- Ensure backward compatibility
- Add appropriate tests

**Change Type:** feature

**Scope:** medium

## Affected Areas
- src/core

## Ambiguities
- None identified
`;

const SYNTHETIC_SCOUT_REPORT = `# Scout Report

## Relevant Files
- \`src/core/issue-orchestrator.ts\` - Main orchestration logic
- \`src/agents/types.ts\` - Type definitions

## Test Files
- \`tests/issue-orchestrator.test.ts\`
`;

const SYNTHETIC_IMPLEMENTATION_PLAN = `# Implementation Plan: Issue

## Tasks

### Task: task-001 - Implement core changes

**Description:** Make the primary code changes required by the issue.
**Files:** src/core/issue-orchestrator.ts
**Dependencies:** none
**Complexity:** moderate
**Acceptance Criteria:**
- Core changes implemented correctly

### Task: task-002 - Add tests

**Description:** Write tests for the changes.
**Files:** tests/issue-orchestrator.test.ts
**Dependencies:** task-001
**Complexity:** simple
**Acceptance Criteria:**
- Tests cover new functionality
`;

const SYNTHETIC_REVIEW = `# Code Review

**Verdict:** pass

## Summary
The implementation looks correct and follows existing patterns.
`;

const SYNTHETIC_PR_CONTENT = `---
title: "Implement requested changes"
labels: ["enhancement"]
---

## Summary

This PR implements the changes requested in the issue.
`;

const THREE_TASK_PLAN = `# Implementation Plan: Issue

## Tasks

### Task: task-001 - Implement core changes

**Description:** Make the primary code changes.
**Files:** src/core/issue-orchestrator.ts
**Dependencies:** none
**Complexity:** moderate
**Acceptance Criteria:**
- Core changes implemented

### Task: task-002 - Add tests

**Description:** Write tests for the changes.
**Files:** tests/issue-orchestrator.test.ts
**Dependencies:** none
**Complexity:** simple
**Acceptance Criteria:**
- Tests pass

### Task: task-003 - Always blocked task

**Description:** This task is configured to always fail in the test.
**Files:** src/blocked.ts
**Dependencies:** none
**Complexity:** simple
**Acceptance Criteria:**
- Will never pass (for testing blocked-task behavior)
`;

// ── E2E Launcher ──────────────────────────────────────────────────────────────

/**
 * Override function: return an AgentResult to short-circuit the default behavior,
 * or return null to fall through to the next override or default behavior.
 */
type OverrideFn = (invocation: AgentInvocation) => Promise<AgentResult | null>;

/**
 * Minimal agent launcher for e2e tests.
 *
 * Writes synthetic output files (matching what real agents would produce) and
 * returns successful results by default. Supports per-invocation overrides for
 * testing failure and retry scenarios.
 */
class E2ELauncher {
  private readonly overrides: OverrideFn[] = [];

  addOverride(fn: OverrideFn): void {
    this.overrides.push(fn);
  }

  async launchAgent(invocation: AgentInvocation, _worktreePath: string): Promise<AgentResult> {
    const start = Date.now();

    // Try registered overrides first
    for (const override of this.overrides) {
      const result = await override(invocation);
      if (result !== null) return result;
    }

    // Default: write synthetic output and return success
    await this.writeSyntheticOutput(invocation);

    const outputExists = await exists(invocation.outputPath);
    return {
      agent: invocation.agent,
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: Date.now() - start,
      stdout: '',
      stderr: '',
      tokenUsage: 500,
      outputPath: invocation.outputPath,
      outputExists,
      error: undefined,
    };
  }

  private async writeSyntheticOutput(invocation: AgentInvocation): Promise<void> {
    // Skip writing when outputPath is an existing directory (e.g. code-writer, test-writer
    // which write changes in-place to the worktree rather than a single output file).
    try {
      const s = await stat(invocation.outputPath);
      if (s.isDirectory()) return;
    } catch {
      // Path doesn't exist yet — treat it as a file output path
    }

    const content = this.syntheticContent(invocation);
    await ensureDir(dirname(invocation.outputPath));
    await writeFile(invocation.outputPath, content, 'utf-8');
  }

  private syntheticContent(invocation: AgentInvocation): string {
    const { agent } = invocation;
    const outFile = basename(invocation.outputPath);

    if (agent === 'issue-analyst' || outFile === 'analysis.md') return SYNTHETIC_ANALYSIS;
    if (agent === 'codebase-scout' || outFile === 'scout-report.md') return SYNTHETIC_SCOUT_REPORT;
    if (agent === 'implementation-planner' || outFile === 'implementation-plan.md') return SYNTHETIC_IMPLEMENTATION_PLAN;
    if (agent === 'pr-composer' || outFile === 'pr-content.md') return SYNTHETIC_PR_CONTENT;
    if (agent === 'code-reviewer' || outFile.startsWith('review')) return SYNTHETIC_REVIEW;

    return '# Output\n\nSynthetic output.\n';
  }

  /** Helper: build a failure result for a given invocation. */
  static failResult(invocation: AgentInvocation, message: string): AgentResult {
    return {
      agent: invocation.agent,
      success: false,
      exitCode: 1,
      timedOut: false,
      duration: 5,
      stdout: '',
      stderr: message,
      tokenUsage: 0,
      outputPath: invocation.outputPath,
      outputExists: false,
      error: message,
    };
  }
}

// ── Fixtures & Helpers ────────────────────────────────────────────────────────

const ISSUE: IssueDetail = {
  number: 1,
  title: 'E2E Test Issue',
  body: 'Test issue body',
  labels: [],
  assignees: [],
  comments: [],
  state: 'open',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  linkedPRs: [],
};

function makeConfig(overrides: Partial<CadreConfig['options']> = {}): CadreConfig {
  return CadreConfigSchema.parse({
    projectName: 'test',
    repository: 'test/repo',
    repoPath: '/tmp',
    issues: { ids: [1] },
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: false,
      draft: false,
      labels: [],
      reviewers: [],
      linkIssue: false,
    },
    options: {
      maxRetriesPerTask: 2,
      maxParallelAgents: 2,
      dryRun: false,
      buildVerification: true,
      testVerification: true,
      ...overrides,
    },
    commands: {
      build: 'echo build',
      test: 'echo test',
    },
  });
}

function makeLogger(logDir: string): Logger {
  return new Logger({ source: 'e2e-test', logDir, console: false, level: 'warn' });
}

function makeWorktree(worktreePath: string): WorktreeInfo {
  return {
    issueNumber: ISSUE.number,
    path: worktreePath,
    branch: 'cadre/issue-1',
    exists: true,
    baseCommit: 'deadbeef',
  };
}

/** Returns the progressDir that IssueOrchestrator will compute internally. */
function progressDirFor(worktreePath: string): string {
  return join(worktreePath, '.cadre', 'issues', String(ISSUE.number));
}

async function buildOrchestrator(
  worktreePath: string,
  launcher: E2ELauncher,
  configOverrides: Partial<CadreConfig['options']> = {},
): Promise<{ orchestrator: IssueOrchestrator; checkpoint: CheckpointManager }> {
  const config = makeConfig(configOverrides);
  const logger = makeLogger(join(worktreePath, '.cadre', 'logs'));
  const progressDir = progressDirFor(worktreePath);
  const checkpoint = new CheckpointManager(progressDir, logger);
  await checkpoint.load(String(ISSUE.number));

  const orchestrator = new IssueOrchestrator(
    config,
    ISSUE,
    makeWorktree(worktreePath),
    checkpoint,
    launcher as unknown as AgentLauncher,
    new MockPlatformProvider(),
    logger,
  );

  return { orchestrator, checkpoint };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('e2e pipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tempDir = join(tmpdir(), `cadre-e2e-${unique}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('happy path: all 5 phases succeed and pr-content.md is written', async () => {
    const launcher = new E2ELauncher();
    const { orchestrator } = await buildOrchestrator(tempDir, launcher);

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(5);
    expect(result.phases.every((p) => p.success)).toBe(true);

    const prContentPath = join(progressDirFor(tempDir), 'pr-content.md');
    await expect(exists(prContentPath)).resolves.toBe(true);
  });

  it('retry path: task-001 code-writer fails on first attempt and succeeds on second', async () => {
    const launcher = new E2ELauncher();
    let task001Calls = 0;

    launcher.addOverride(async (inv) => {
      if (inv.agent === 'code-writer' && inv.taskId === 'task-001') {
        task001Calls++;
        if (task001Calls === 1) {
          return E2ELauncher.failResult(inv, 'Simulated first-attempt failure');
        }
      }
      return null;
    });

    const { orchestrator } = await buildOrchestrator(tempDir, launcher);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    // code-writer must have been called at least twice for task-001
    expect(task001Calls).toBeGreaterThanOrEqual(2);
  });

  it('blocked task: pipeline succeeds overall and blocked task appears in checkpoint', async () => {
    const launcher = new E2ELauncher();

    // Override implementation-planner to produce a 3-task plan
    launcher.addOverride(async (inv) => {
      if (inv.agent === 'implementation-planner') {
        await ensureDir(dirname(inv.outputPath));
        await writeFile(inv.outputPath, THREE_TASK_PLAN, 'utf-8');
        return {
          agent: inv.agent,
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 5,
          stdout: '',
          stderr: '',
          tokenUsage: 500,
          outputPath: inv.outputPath,
          outputExists: true,
          error: undefined,
        };
      }
      // task-003 code-writer always fails
      if (inv.agent === 'code-writer' && inv.taskId === 'task-003') {
        return E2ELauncher.failResult(inv, 'Blocked task always fails');
      }
      return null;
    });

    const { orchestrator, checkpoint } = await buildOrchestrator(tempDir, launcher);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);

    // At least task-003 should be blocked in checkpoint state
    const cpState = checkpoint.getState();
    expect(cpState.blockedTasks.length).toBeGreaterThanOrEqual(1);
    expect(cpState.blockedTasks).toContain('task-003');
  });

  it('resume: phases 1 and 2 are skipped on second run with tokenUsage === 0', async () => {
    const launcher = new E2ELauncher();

    // First run with dryRun: true — stops after phase 2
    const { orchestrator: orchestrator1 } = await buildOrchestrator(tempDir, launcher, {
      dryRun: true,
    });
    await orchestrator1.run();

    // Checkpoint files must exist on disk after the first run
    const checkpointPath = join(progressDirFor(tempDir), 'checkpoint.json');
    await expect(exists(checkpointPath)).resolves.toBe(true);

    // Second run: fresh orchestrator with same progressDir, no dryRun
    const { orchestrator: orchestrator2 } = await buildOrchestrator(tempDir, launcher, {
      dryRun: false,
    });
    const result2 = await orchestrator2.run();

    expect(result2.success).toBe(true);
    expect(result2.phases).toHaveLength(5);

    // Phases 1 and 2 were completed in the first run, so they are skipped (tokenUsage === 0)
    const phase1 = result2.phases.find((p) => p.phase === 1);
    const phase2 = result2.phases.find((p) => p.phase === 2);
    expect(phase1?.tokenUsage).toBe(0);
    expect(phase2?.tokenUsage).toBe(0);
  });
});
