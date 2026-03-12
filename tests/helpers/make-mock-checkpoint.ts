import { vi } from 'vitest';
import type { CheckpointManager } from '@cadre-dev/framework/engine';

/**
 * Create a mock CheckpointManager.
 *
 * @param completedPhaseIds - Phase IDs to report as already completed.
 *   `isPhaseCompleted()` dynamically returns true for these IDs.
 * @param overrides - Additional method overrides spread onto the mock.
 */
export function makeMockCheckpoint(
  completedPhaseIds: number[] = [],
  overrides: Record<string, unknown> = {},
): CheckpointManager {
  const completedSubTasks = new Set<string>();

  return {
    load: vi.fn().mockResolvedValue({}),
    getState: vi.fn().mockReturnValue({
      workItemId: '42',
      currentPhase: 1,
      completedPhases: completedPhaseIds,
      completedTasks: [],
      blockedTasks: [],
      failedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '/tmp/worktree-42',
      branchName: 'cadre/issue-42',
      baseCommit: 'abc123',
      resumeCount: 0,
    }),
    getResumePoint: vi.fn().mockReturnValue({ phase: 1, task: null }),
    isPhaseCompleted: vi.fn().mockImplementation((id: number) =>
      completedPhaseIds.includes(id),
    ),
    isTaskCompleted: vi.fn().mockReturnValue(false),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    failTask: vi.fn().mockResolvedValue(undefined),
    blockTask: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    recordGateResult: vi.fn().mockResolvedValue(undefined),
    setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
    startSubTask: vi.fn().mockResolvedValue(undefined),
    completeSubTask: vi.fn(async (id: string) => { completedSubTasks.add(id); }),
    isSubTaskCompleted: vi.fn((id: string) => completedSubTasks.has(id)),
    ...overrides,
  } as unknown as CheckpointManager;
}
