import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, rename, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointManager, FleetCheckpointManager } from '../src/core/checkpoint.js';
import type { CheckpointState, FleetIssueStatus } from '../src/core/checkpoint.js';
import { Logger } from '../src/logging/logger.js';
import type { GateResult } from '../src/agents/types.js';

describe('CheckpointManager', () => {
  let mockLogger: Logger;
  let tempDir: string;

  beforeEach(async () => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    tempDir = join(tmpdir(), `cadre-cp-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize a fresh checkpoint', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');

    expect(state.issueNumber).toBe(42);
    expect(state.currentPhase).toBe(0);
    expect(state.completedPhases).toEqual([]);
    expect(state.completedTasks).toEqual([]);
    expect(state.resumeCount).toBe(0);
  });

  it('should persist and reload checkpoint', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');

    await manager.startPhase(1);
    await manager.completePhase(1, 'analysis.md');

    // Reload
    const manager2 = new CheckpointManager(tempDir, mockLogger);
    const state2 = await manager2.load('42');

    expect(state2.completedPhases).toContain(1);
    expect(state2.resumeCount).toBe(1);
  });

  it('should track task completion', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.startPhase(3);
    await manager.startTask('task-001');
    await manager.completeTask('task-001');

    const state = manager.getState();
    expect(state.completedTasks).toContain('task-001');
  });

  it('should track failed tasks', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.startPhase(3);
    await manager.startTask('task-001');
    await manager.failTask('task-001', 'Agent timeout', 1);

    const state = manager.getState();
    expect(state.failedTasks).toHaveLength(1);
    expect(state.failedTasks[0].taskId).toBe('task-001');
    expect(state.failedTasks[0].error).toBe('Agent timeout');
  });

  it('should record token usage', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordTokenUsage('issue-analyst', 1, 3000);
    await manager.recordTokenUsage('codebase-scout', 1, 4000);

    const state = manager.getState();
    expect(state.tokenUsage.total).toBe(7000);
    expect(state.tokenUsage.byPhase[1]).toBe(7000);
    expect(state.tokenUsage.byAgent['issue-analyst']).toBe(3000);
  });

  it('should provide resume point', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.startPhase(1);
    await manager.completePhase(1, 'analysis.md');
    await manager.startPhase(2);

    const resume = manager.getResumePoint();
    expect(resume.phase).toBe(2);
  });

  it('resetPhases should remove specified phases from completedPhases', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.completePhase(1, 'analysis.md');
    await manager.completePhase(2, 'planning.md');
    await manager.completePhase(3, 'implementation.md');
    await manager.completePhase(4, 'integration.md');
    await manager.completePhase(5, 'pr.md');

    await manager.resetPhases([3, 4, 5]);

    const state = manager.getState();
    expect(state.completedPhases).toEqual([1, 2]);
    expect(state.completedPhases).not.toContain(3);
    expect(state.completedPhases).not.toContain(4);
    expect(state.completedPhases).not.toContain(5);
  });

  it('resetPhases should persist to disk', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.completePhase(1, 'analysis.md');
    await manager.completePhase(2, 'planning.md');
    await manager.completePhase(3, 'implementation.md');

    await manager.resetPhases([3]);

    // Reload from disk and verify the reset was persisted
    const manager2 = new CheckpointManager(tempDir, mockLogger);
    const state = await manager2.load('42');
    expect(state.completedPhases).toContain(1);
    expect(state.completedPhases).toContain(2);
    expect(state.completedPhases).not.toContain(3);
  });

  it('resetPhases with no-op IDs leaves completedPhases unchanged', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.completePhase(1, 'analysis.md');
    await manager.completePhase(2, 'planning.md');

    await manager.resetPhases([3, 4, 5]); // phases not yet completed

    const state = manager.getState();
    expect(state.completedPhases).toEqual([1, 2]);
  });

  it('should initialize with budgetExceeded undefined', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');
    expect(state.budgetExceeded).toBeUndefined();
  });

  it('should initialize gateResults as empty object', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');
    expect(state.gateResults).toEqual({});
  });

  it('should record a gate result for a phase', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordGateResult(1, { status: 'pass', warnings: [], errors: [] });

    const state = manager.getState();
    expect(state.gateResults?.[1]).toEqual({ status: 'pass', warnings: [], errors: [] });
  });

  it('should record gate results for multiple phases independently', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordGateResult(1, { status: 'pass', warnings: [], errors: [] });
    await manager.recordGateResult(2, { status: 'warn', warnings: ['slow test'], errors: [] });
    await manager.recordGateResult(3, { status: 'fail', warnings: [], errors: ['no diff'] });

    const state = manager.getState();
    expect(state.gateResults?.[1]?.status).toBe('pass');
    expect(state.gateResults?.[2]?.status).toBe('warn');
    expect(state.gateResults?.[3]?.status).toBe('fail');
  });

  it('should overwrite existing gate result when called again for the same phase', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordGateResult(1, { status: 'fail', warnings: [], errors: ['bad output'] });
    await manager.recordGateResult(1, { status: 'pass', warnings: [], errors: [] });

    const state = manager.getState();
    expect(state.gateResults?.[1]?.status).toBe('pass');
  });

  it('should persist gate results across reload', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordGateResult(2, { status: 'warn', warnings: ['low coverage'], errors: [] });

    const manager2 = new CheckpointManager(tempDir, mockLogger);
    const state2 = await manager2.load('42');

    expect(state2.gateResults?.[2]?.status).toBe('warn');
    expect(state2.gateResults?.[2]?.warnings).toContain('low coverage');
  });

  it('should throw when recordGateResult is called before load', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);

    await expect(
      manager.recordGateResult(1, { status: 'pass', warnings: [], errors: [] }),
    ).rejects.toThrow('Checkpoint not loaded');
  });

  it('CheckpointState should accept budgetExceeded as optional boolean', () => {
    const base: CheckpointState = {
      issueNumber: 1,
      version: 1,
      currentPhase: 0,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
    };
    expect(base.budgetExceeded).toBeUndefined();

    const withFlag: CheckpointState = { ...base, budgetExceeded: true };
    expect(withFlag.budgetExceeded).toBe(true);
  });

  it('should initialise gateResults to empty object on fresh checkpoint', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');

    expect(state.gateResults).toEqual({});
  });

  it('should record a gate result and persist it', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    const result: GateResult = { status: 'pass', warnings: [], errors: [] };
    await manager.recordGateResult(2, result);

    const state = manager.getState();
    expect(state.gateResults?.[2]).toEqual(result);
  });

  it('should persist gate result across reload', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    const result: GateResult = { status: 'warn', warnings: ['low coverage'], errors: [] };
    await manager.recordGateResult(3, result);

    const manager2 = new CheckpointManager(tempDir, mockLogger);
    const state2 = await manager2.load('42');

    expect(state2.gateResults?.[3]).toEqual(result);
  });

  it('should overwrite existing gate result for the same phase', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    await manager.recordGateResult(1, { status: 'fail', warnings: [], errors: ['build failed'] });
    await manager.recordGateResult(1, { status: 'pass', warnings: [], errors: [] });

    const state = manager.getState();
    expect(state.gateResults?.[1]).toEqual({ status: 'pass', warnings: [], errors: [] });
  });

  it('should record gate results for multiple phases independently', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    const r1: GateResult = { status: 'pass', warnings: [], errors: [] };
    const r2: GateResult = { status: 'warn', warnings: ['slow test'], errors: [] };
    await manager.recordGateResult(1, r1);
    await manager.recordGateResult(2, r2);

    const state = manager.getState();
    expect(state.gateResults?.[1]).toEqual(r1);
    expect(state.gateResults?.[2]).toEqual(r2);
  });

  it('should throw when recording gate result before loading', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const result: GateResult = { status: 'pass', warnings: [], errors: [] };

    await expect(manager.recordGateResult(1, result)).rejects.toThrow('Checkpoint not loaded');
  });

  it('should initialize subTasks as empty object on fresh checkpoint', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    const state = await manager.load('42');
    expect(state.subTasks).toEqual({});
  });

  it('isSubTaskCompleted should return false before completeSubTask is called', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    expect(manager.isSubTaskCompleted('task-001:step-1')).toBe(false);
  });

  it('isSubTaskCompleted should return true after completeSubTask is called', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    await manager.completeSubTask('task-001:step-1');
    expect(manager.isSubTaskCompleted('task-001:step-1')).toBe(true);
  });

  it('startSubTask should set sub-task entry to false', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    await manager.startSubTask('task-001:step-1');
    expect(manager.isSubTaskCompleted('task-001:step-1')).toBe(false);
  });

  it('sub-task state should persist across checkpoint reload', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    await manager.completeSubTask('task-001:step-1');

    const manager2 = new CheckpointManager(tempDir, mockLogger);
    await manager2.load('42');
    expect(manager2.isSubTaskCompleted('task-001:step-1')).toBe(true);
  });

  it('resetPhases should clear subTasks entries', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    await manager.completeSubTask('task-001:step-1');
    await manager.completeSubTask('task-002:step-1');

    await manager.resetPhases([3]);

    const state = manager.getState();
    expect(state.subTasks).toEqual({});
  });

  it('completeTask should remove sub-task entries for the completed task', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    await manager.startTask('task-001');
    await manager.completeSubTask('task-001:step-1');
    await manager.completeSubTask('task-001:step-2');
    await manager.completeSubTask('task-002:step-1');

    await manager.completeTask('task-001');

    const state = manager.getState();
    expect(state.subTasks?.['task-001:step-1']).toBeUndefined();
    expect(state.subTasks?.['task-001:step-2']).toBeUndefined();
    // Sub-tasks for other tasks should remain
    expect(state.subTasks?.['task-002:step-1']).toBe(true);
  });

  it('loadTokenRecords should return empty array when checkpoint has no tokenRecords', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');
    expect(manager.loadTokenRecords()).toEqual([]);
  });

  it('saveTokenRecords and loadTokenRecords should round-trip correctly', async () => {
    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('42');

    const records = [
      { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 3000, timestamp: '2024-01-01T00:00:00.000Z', input: 1000, output: 2000 },
      { issueNumber: 42, agent: 'codebase-scout', phase: 1, tokens: 4000, timestamp: '2024-01-01T00:01:00.000Z' },
    ];
    await manager.saveTokenRecords(records);

    const manager2 = new CheckpointManager(tempDir, mockLogger);
    await manager2.load('42');
    expect(manager2.loadTokenRecords()).toEqual(records);
  });

  it('loadTokenRecords should return empty array for legacy checkpoint without tokenRecords field', async () => {
    // Write a checkpoint file that lacks the tokenRecords field
    const { writeFile } = await import('node:fs/promises');
    const legacyState = {
      issueNumber: 99,
      version: 1,
      currentPhase: 0,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
    };
    await writeFile(join(tempDir, 'checkpoint.json'), JSON.stringify(legacyState));

    const manager = new CheckpointManager(tempDir, mockLogger);
    await manager.load('99');
    expect(manager.loadTokenRecords()).toEqual([]);
  });
});

describe('FleetCheckpointManager', () => {
  let mockLogger: Logger;
  let tempDir: string;

  beforeEach(async () => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    tempDir = join(tmpdir(), `cadre-fleet-cp-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize fresh fleet checkpoint', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    const state = await manager.load();
    expect(state.projectName).toBe('my-project');
    expect(state.issues).toEqual({});
    expect(state.resumeCount).toBe(0);
  });

  it('isIssueCompleted should return true for completed status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(1, 'completed', '/path', 'branch', 5, 'Fix bug');
    expect(manager.isIssueCompleted(1)).toBe(true);
  });

  it('isIssueCompleted should return true for budget-exceeded status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(2, 'budget-exceeded', '/path', 'branch', 3, 'Add feature');
    expect(manager.isIssueCompleted(2)).toBe(true);
  });

  it('isIssueCompleted should return false for in-progress status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(3, 'in-progress', '/path', 'branch', 1, 'Refactor module');
    expect(manager.isIssueCompleted(3)).toBe(false);
  });

  it('isIssueCompleted should return false for failed status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(4, 'failed', '/path', 'branch', 2, 'Update docs', 'Some error');
    expect(manager.isIssueCompleted(4)).toBe(false);
  });

  it('isIssueCompleted should return false for blocked status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(5, 'blocked', '/path', 'branch', 2, 'Improve performance');
    expect(manager.isIssueCompleted(5)).toBe(false);
  });

  it('isIssueCompleted should return false for not-started status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(6, 'not-started', '/path', 'branch', 0, 'New feature');
    expect(manager.isIssueCompleted(6)).toBe(false);
  });

  it('isIssueCompleted should return false for unknown issue', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    expect(manager.isIssueCompleted(999)).toBe(false);
  });

  it('FleetIssueStatus should accept budget-exceeded as a valid status', () => {
    const status: FleetIssueStatus = {
      status: 'budget-exceeded',
      issueTitle: 'Some feature',
      worktreePath: '/path',
      branchName: 'branch',
      lastPhase: 2,
    };
    expect(status.status).toBe('budget-exceeded');
  });

  it('FleetIssueStatus should accept code-complete as a valid status', () => {
    const status: FleetIssueStatus = {
      status: 'code-complete',
      issueTitle: 'Code done, PR needed',
      worktreePath: '/path',
      branchName: 'branch',
      lastPhase: 4,
    };
    expect(status.status).toBe('code-complete');
  });

  it('isIssueCompleted should return false for code-complete status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(99, 'code-complete', '/path', 'cadre/issue-99', 4, 'Code complete issue');
    expect(manager.isIssueCompleted(99)).toBe(false);
  });

  it('should persist and reload fleet checkpoint', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(7, 'budget-exceeded', '/worktree/7', 'issue-7', 3, 'My Issue Title');

    const manager2 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager2.load();
    expect(manager2.getIssueStatus(7)?.status).toBe('budget-exceeded');
    expect(manager2.isIssueCompleted(7)).toBe(true);
  });

  it('should store issueTitle in FleetIssueStatus', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(10, 'in-progress', '/worktree/10', 'issue-10', 1, 'Fix authentication bug');

    const status = manager.getIssueStatus(10);
    expect(status?.issueTitle).toBe('Fix authentication bug');
  });

  it('should persist issueTitle across reload', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(11, 'completed', '/worktree/11', 'issue-11', 5, 'Add dark mode support');

    const manager2 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager2.load();
    expect(manager2.getIssueStatus(11)?.issueTitle).toBe('Add dark mode support');
  });

  it('should update issueTitle when setIssueStatus is called again', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(12, 'in-progress', '/worktree/12', 'issue-12', 1, 'Original title');
    await manager.setIssueStatus(12, 'completed', '/worktree/12', 'issue-12', 5, 'Updated title');

    expect(manager.getIssueStatus(12)?.issueTitle).toBe('Updated title');
  });

  it('should store issueTitle alongside error when status is failed', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(13, 'failed', '/worktree/13', 'issue-13', 2, 'Some issue', 'Build failed');

    const status = manager.getIssueStatus(13);
    expect(status?.issueTitle).toBe('Some issue');
    expect(status?.error).toBe('Build failed');
  });

  it('FleetIssueStatus type requires issueTitle field', () => {
    const status: FleetIssueStatus = {
      status: 'completed',
      issueTitle: 'Implement new API endpoint',
      worktreePath: '/worktree/14',
      branchName: 'issue-14',
      lastPhase: 5,
    };
    expect(status.issueTitle).toBe('Implement new API endpoint');
  });

  it('should store empty string issueTitle when provided', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(15, 'in-progress', '/worktree/15', 'issue-15', 0, '');

    expect(manager.getIssueStatus(15)?.issueTitle).toBe('');
  });

  it('should set updatedAt to an ISO timestamp when setIssueStatus is called', async () => {
    const before = new Date().toISOString();
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(20, 'in-progress', '/worktree/20', 'issue-20', 1, 'Some issue');
    const after = new Date().toISOString();

    const status = manager.getIssueStatus(20);
    expect(status?.updatedAt).toBeDefined();
    expect(status!.updatedAt! >= before).toBe(true);
    expect(status!.updatedAt! <= after).toBe(true);
  });

  it('should update updatedAt on every setIssueStatus call', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(21, 'in-progress', '/worktree/21', 'issue-21', 1, 'Issue');
    const first = manager.getIssueStatus(21)?.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    await manager.setIssueStatus(21, 'completed', '/worktree/21', 'issue-21', 5, 'Issue');
    const second = manager.getIssueStatus(21)?.updatedAt;

    expect(second).toBeDefined();
    expect(second! >= first!).toBe(true);
  });

  it('should persist updatedAt across reload', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(22, 'completed', '/worktree/22', 'issue-22', 5, 'Persist test');
    const original = manager.getIssueStatus(22)?.updatedAt;

    const manager2 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager2.load();
    expect(manager2.getIssueStatus(22)?.updatedAt).toBe(original);
  });

  it('FleetIssueStatus should accept updatedAt as an optional field', () => {
    const withoutUpdatedAt: FleetIssueStatus = {
      status: 'not-started',
      issueTitle: 'No timestamp',
      worktreePath: '/path',
      branchName: 'branch',
      lastPhase: 0,
    };
    expect(withoutUpdatedAt.updatedAt).toBeUndefined();

    const withUpdatedAt: FleetIssueStatus = {
      ...withoutUpdatedAt,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(withUpdatedAt.updatedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('FleetIssueStatus should accept dep-failed, dep-merge-conflict, dep-build-broken, dep-blocked as valid statuses', () => {
    const depFailed: FleetIssueStatus = { status: 'dep-failed', issueTitle: 'Dep failed', worktreePath: '/path', branchName: 'branch', lastPhase: 1 };
    const depMerge: FleetIssueStatus = { status: 'dep-merge-conflict', issueTitle: 'Dep merge conflict', worktreePath: '/path', branchName: 'branch', lastPhase: 1 };
    const depBroken: FleetIssueStatus = { status: 'dep-build-broken', issueTitle: 'Dep build broken', worktreePath: '/path', branchName: 'branch', lastPhase: 1 };
    const depBlocked: FleetIssueStatus = { status: 'dep-blocked', issueTitle: 'Dep blocked', worktreePath: '/path', branchName: 'branch', lastPhase: 0 };

    expect(depFailed.status).toBe('dep-failed');
    expect(depMerge.status).toBe('dep-merge-conflict');
    expect(depBroken.status).toBe('dep-build-broken');
    expect(depBlocked.status).toBe('dep-blocked');
  });

  it('isIssueCompleted should return true for dep-blocked status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(50, 'dep-blocked', '/path', 'branch', 0, 'Dep blocked issue');
    expect(manager.isIssueCompleted(50)).toBe(true);
  });

  it('isIssueCompleted should return false for dep-failed status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(51, 'dep-failed', '/path', 'branch', 0, 'Dep failed issue');
    expect(manager.isIssueCompleted(51)).toBe(false);
  });

  it('setDag and markWaveComplete should round-trip through save/load', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();

    const dag: Record<number, number[]> = { 1: [], 2: [1], 3: [1] };
    const waves: number[][] = [[1], [2, 3]];
    await manager.setDag(dag, waves);

    const manager2 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager2.load();
    const state2 = manager2.getState();
    expect(state2.dag).toEqual(dag);
    expect(state2.waves).toEqual(waves);
    expect(state2.completedWaves).toEqual([]);

    await manager2.markWaveComplete(0);
    const manager3 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager3.load();
    expect(manager3.getState().completedWaves).toEqual([0]);
  });

  it('markWaveComplete should not duplicate entries', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setDag({ 1: [] }, [[1]]);
    await manager.markWaveComplete(0);
    await manager.markWaveComplete(0);
    expect(manager.getState().completedWaves).toEqual([0]);
  });
});
