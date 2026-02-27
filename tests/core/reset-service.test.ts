import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn(),
}));

import { ResetService } from '../../src/core/reset-service.js';
import { FleetCheckpointManager } from '../../src/core/checkpoint.js';
import type { RuntimeConfig } from '../../src/config/loader.js';

const MockFleetCheckpointManager = FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>;

function makeConfig(): RuntimeConfig {
  return {
    stateDir: '/tmp/cadre-state',
    projectName: 'test-project',
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

describe('ResetService', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockSetIssueStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function setUpCheckpoint(issues: Record<number, { status: string; issueTitle?: string }>) {
    MockFleetCheckpointManager.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({ issues }),
      setIssueStatus: mockSetIssueStatus,
    }));
  }

  describe('reset() — single issue', () => {
    it('should call setIssueStatus with not-started and issueTitle', async () => {
      setUpCheckpoint({ 42: { status: 'in-progress', issueTitle: 'Fix login bug' } });

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset(42);

      expect(mockSetIssueStatus).toHaveBeenCalledOnce();
      expect(mockSetIssueStatus).toHaveBeenCalledWith(42, 'not-started', '', '', 0, 'Fix login bug');
    });

    it('should fall back to empty string when issueTitle is missing', async () => {
      setUpCheckpoint({ 7: { status: 'failed' } });

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset(7);

      expect(mockSetIssueStatus).toHaveBeenCalledWith(7, 'not-started', '', '', 0, '');
    });

    it('should print confirmation message', async () => {
      setUpCheckpoint({ 10: { status: 'completed', issueTitle: 'Refactor' } });

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset(10);

      expect(consoleSpy).toHaveBeenCalledWith('Reset issue #10');
    });

    it('should log the reset with issue number and fromPhase', async () => {
      setUpCheckpoint({ 5: { status: 'in-progress', issueTitle: 'Test' } });
      const logger = makeLogger();

      const service = new ResetService(makeConfig(), logger);
      await service.reset(5, 3);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Resetting issue #5'),
        expect.objectContaining({ issueNumber: 5, data: { fromPhase: 3 } }),
      );
    });
  });

  describe('reset() — entire fleet', () => {
    it('should call setIssueStatus for every issue in the fleet', async () => {
      setUpCheckpoint({
        1: { status: 'completed', issueTitle: 'Issue one' },
        2: { status: 'failed', issueTitle: 'Issue two' },
        3: { status: 'in-progress', issueTitle: 'Issue three' },
      });

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset();

      expect(mockSetIssueStatus).toHaveBeenCalledTimes(3);
      expect(mockSetIssueStatus).toHaveBeenCalledWith(1, 'not-started', '', '', 0, 'Issue one');
      expect(mockSetIssueStatus).toHaveBeenCalledWith(2, 'not-started', '', '', 0, 'Issue two');
      expect(mockSetIssueStatus).toHaveBeenCalledWith(3, 'not-started', '', '', 0, 'Issue three');
    });

    it('should not call setIssueStatus when there are no issues', async () => {
      setUpCheckpoint({});

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset();

      expect(mockSetIssueStatus).not.toHaveBeenCalled();
    });

    it('should print "Reset all issues" message', async () => {
      setUpCheckpoint({ 1: { status: 'completed', issueTitle: 'Done' } });

      const service = new ResetService(makeConfig(), makeLogger());
      await service.reset();

      expect(consoleSpy).toHaveBeenCalledWith('Reset all issues');
    });

    it('should log "Resetting entire fleet"', async () => {
      setUpCheckpoint({});
      const logger = makeLogger();

      const service = new ResetService(makeConfig(), logger);
      await service.reset();

      expect(logger.info).toHaveBeenCalledWith('Resetting entire fleet');
    });
  });
});
