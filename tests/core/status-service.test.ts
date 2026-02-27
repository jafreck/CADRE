import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

vi.mock('../../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      projectName: 'test-project',
      issues: {},
      tokenUsage: { total: 0, byIssue: {} },
      lastCheckpoint: '',
      resumeCount: 0,
    }),
  })),
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      issueNumber: 1,
      version: 1,
      currentPhase: 1,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
    }),
  })),
}));

vi.mock('../../src/cli/status-renderer.js', () => ({
  renderFleetStatus: vi.fn().mockReturnValue('fleet status table'),
  renderIssueDetail: vi.fn().mockReturnValue('issue detail table'),
}));

import { StatusService } from '../../src/core/status-service.js';
import { FleetCheckpointManager, CheckpointManager } from '../../src/core/checkpoint.js';
import { exists } from '../../src/util/fs.js';
import { renderFleetStatus, renderIssueDetail } from '../../src/cli/status-renderer.js';
import type { RuntimeConfig } from '../../src/config/loader.js';

const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;
const MockCheckpointManager = CheckpointManager as unknown as ReturnType<typeof vi.fn>;
const mockExists = exists as ReturnType<typeof vi.fn>;
const mockRenderFleetStatus = renderFleetStatus as ReturnType<typeof vi.fn>;
const mockRenderIssueDetail = renderIssueDetail as ReturnType<typeof vi.fn>;

function makeConfig(): RuntimeConfig {
  return {
    stateDir: '/tmp/cadre-state',
    projectName: 'test-project',
    copilot: { model: 'claude-sonnet-4.6', cliCommand: 'copilot', agentDir: '.agents', timeout: 300000 },
  } as unknown as RuntimeConfig;
}

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

describe('StatusService', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('status() — no fleet checkpoint', () => {
    beforeEach(() => {
      mockExists.mockResolvedValue(false);
    });

    it('should print "No fleet checkpoint found." when checkpoint file is missing', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status();

      expect(consoleSpy).toHaveBeenCalledWith('No fleet checkpoint found.');
    });

    it('should not instantiate FleetCheckpointManager when no checkpoint exists', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status();

      expect(MockFleetCheckpointManager).not.toHaveBeenCalled();
    });

    it('should not render anything when checkpoint is missing and issueNumber is provided', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(42);

      expect(mockRenderFleetStatus).not.toHaveBeenCalled();
      expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    });
  });

  describe('status() — fleet checkpoint exists, no issue filter', () => {
    const fleetState = {
      projectName: 'test-project',
      issues: {
        42: {
          status: 'completed' as const,
          issueTitle: 'Fix bug',
          worktreePath: '',
          branchName: 'cadre/issue-42',
          lastPhase: 5,
          updatedAt: new Date().toISOString(),
        },
      },
      tokenUsage: { total: 1000, byIssue: { 42: 1000 } },
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 2,
    };

    beforeEach(() => {
      mockExists.mockResolvedValue(true);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue(fleetState),
      }));
    });

    it('should call renderFleetStatus with fleet state and copilot config', async () => {
      const config = makeConfig();
      const service = new StatusService(config, makeLogger());
      await service.status();

      expect(mockRenderFleetStatus).toHaveBeenCalledWith(fleetState, config.copilot.model, config.copilot);
    });

    it('should print the rendered fleet status', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status();

      expect(consoleSpy).toHaveBeenCalledWith('fleet status table');
    });

    it('should not render issue detail when no issueNumber is provided', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status();

      expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    });
  });

  describe('status() — with issueNumber not in fleet', () => {
    beforeEach(() => {
      mockExists.mockResolvedValue(true);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          projectName: 'test-project',
          issues: {},
          tokenUsage: { total: 0, byIssue: {} },
          lastCheckpoint: '',
          resumeCount: 0,
        }),
      }));
    });

    it('should print "Issue #n not found" message', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(99);

      expect(consoleSpy).toHaveBeenCalledWith('Issue #99 not found in fleet checkpoint.');
    });

    it('should not attempt to load per-issue checkpoint', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(99);

      expect(MockCheckpointManager).not.toHaveBeenCalled();
    });
  });

  describe('status() — with issueNumber, per-issue checkpoint missing', () => {
    const issueStatus = {
      status: 'in-progress' as const,
      issueTitle: 'My issue',
      worktreePath: '',
      branchName: 'cadre/issue-5',
      lastPhase: 1,
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockExists
        .mockResolvedValueOnce(true)   // fleet checkpoint exists
        .mockResolvedValueOnce(false); // per-issue checkpoint does not
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          projectName: 'test-project',
          issues: { 5: issueStatus },
          tokenUsage: { total: 0, byIssue: {} },
          lastCheckpoint: '',
          resumeCount: 0,
        }),
      }));
    });

    it('should print "No per-issue checkpoint found" message', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(5);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No per-issue checkpoint found for issue #5'));
    });

    it('should not call renderIssueDetail', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(5);

      expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    });
  });

  describe('status() — with issueNumber, per-issue checkpoint present', () => {
    const issueStatus = {
      status: 'in-progress' as const,
      issueTitle: 'Add feature',
      worktreePath: '/tmp/worktrees/issue-7',
      branchName: 'cadre/issue-7',
      lastPhase: 2,
      updatedAt: new Date().toISOString(),
    };

    const issueCheckpointState = {
      issueNumber: 7,
      version: 1,
      currentPhase: 2,
      currentTask: null,
      completedPhases: [1],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 500, byPhase: { 1: 500 }, byAgent: {} },
      worktreePath: '/tmp/worktrees/issue-7',
      branchName: 'cadre/issue-7',
      baseCommit: 'abc123',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 1,
    };

    beforeEach(() => {
      mockExists.mockResolvedValue(true);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          projectName: 'test-project',
          issues: { 7: issueStatus },
          tokenUsage: { total: 500, byIssue: { 7: 500 } },
          lastCheckpoint: new Date().toISOString(),
          resumeCount: 1,
        }),
      }));
      MockCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue(issueCheckpointState),
      }));
    });

    it('should call renderIssueDetail with issue number, status, and checkpoint', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(7);

      expect(mockRenderIssueDetail).toHaveBeenCalledWith(7, issueStatus, issueCheckpointState);
    });

    it('should print the rendered issue detail', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(7);

      expect(consoleSpy).toHaveBeenCalledWith('issue detail table');
    });

    it('should not call renderFleetStatus when filtering by issue', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(7);

      expect(mockRenderFleetStatus).not.toHaveBeenCalled();
    });
  });

  describe('status() — CheckpointManager.load() throws', () => {
    beforeEach(() => {
      mockExists.mockResolvedValue(true);
      MockFleetCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockResolvedValue({
          projectName: 'test-project',
          issues: { 8: { status: 'in-progress', issueTitle: 'Broken' } },
          tokenUsage: { total: 0, byIssue: {} },
          lastCheckpoint: '',
          resumeCount: 0,
        }),
      }));
      MockCheckpointManager.mockImplementation(() => ({
        load: vi.fn().mockRejectedValue(new Error('EACCES')),
      }));
    });

    it('should print graceful fallback message when load throws', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(8);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No per-issue checkpoint found for issue #8'));
    });

    it('should not call renderIssueDetail when load throws', async () => {
      const service = new StatusService(makeConfig(), makeLogger());
      await service.status(8);

      expect(mockRenderIssueDetail).not.toHaveBeenCalled();
    });
  });
});
