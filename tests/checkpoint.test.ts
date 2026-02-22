import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, rename, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointManager, FleetCheckpointManager } from '../src/core/checkpoint.js';
import { Logger } from '../src/logging/logger.js';

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
});
