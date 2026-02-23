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
    await manager.setIssueStatus(1, 'completed', '/path', 'branch', 5);
    expect(manager.isIssueCompleted(1)).toBe(true);
  });

  it('isIssueCompleted should return true for budget-exceeded status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(2, 'budget-exceeded', '/path', 'branch', 3);
    expect(manager.isIssueCompleted(2)).toBe(true);
  });

  it('isIssueCompleted should return false for in-progress status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(3, 'in-progress', '/path', 'branch', 1);
    expect(manager.isIssueCompleted(3)).toBe(false);
  });

  it('isIssueCompleted should return false for failed status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(4, 'failed', '/path', 'branch', 2, 'Some error');
    expect(manager.isIssueCompleted(4)).toBe(false);
  });

  it('isIssueCompleted should return false for blocked status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(5, 'blocked', '/path', 'branch', 2);
    expect(manager.isIssueCompleted(5)).toBe(false);
  });

  it('isIssueCompleted should return false for not-started status', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(6, 'not-started', '/path', 'branch', 0);
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
      worktreePath: '/path',
      branchName: 'branch',
      lastPhase: 2,
    };
    expect(status.status).toBe('budget-exceeded');
  });

  it('should persist and reload fleet checkpoint', async () => {
    const manager = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager.load();
    await manager.setIssueStatus(7, 'budget-exceeded', '/worktree/7', 'issue-7', 3);

    const manager2 = new FleetCheckpointManager(tempDir, 'my-project', mockLogger);
    await manager2.load();
    expect(manager2.getIssueStatus(7)?.status).toBe('budget-exceeded');
    expect(manager2.isIssueCompleted(7)).toBe(true);
  });
});
