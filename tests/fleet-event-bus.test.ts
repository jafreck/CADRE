import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetEventBus } from '../src/core/fleet-event-bus.js';

describe('FleetEventBus', () => {
  let notifications: { dispatch: ReturnType<typeof vi.fn> };
  let fleetProgress: { appendEvent: ReturnType<typeof vi.fn> };
  let bus: FleetEventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = { dispatch: vi.fn().mockResolvedValue(undefined) };
    fleetProgress = { appendEvent: vi.fn().mockResolvedValue(undefined) };
    bus = new FleetEventBus(notifications as any, fleetProgress as any);
  });

  describe('dispatchFleetStarted', () => {
    it('should dispatch a fleet-started event with issueCount and maxParallel', async () => {
      await bus.dispatchFleetStarted(5, 3);
      expect(notifications.dispatch).toHaveBeenCalledTimes(1);
      expect(notifications.dispatch).toHaveBeenCalledWith({
        type: 'fleet-started',
        issueCount: 5,
        maxParallel: 3,
      });
    });
  });

  describe('dispatchFleetCompleted', () => {
    it('should dispatch a fleet-completed event with all parameters', async () => {
      await bus.dispatchFleetCompleted(true, 3, 1, 5000, 12000);
      expect(notifications.dispatch).toHaveBeenCalledWith({
        type: 'fleet-completed',
        success: true,
        prsCreated: 3,
        failedIssues: 1,
        totalDuration: 5000,
        totalTokens: 12000,
      });
    });

    it('should dispatch with success=false when fleet failed', async () => {
      await bus.dispatchFleetCompleted(false, 0, 5, 10000, 8000);
      expect(notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, prsCreated: 0, failedIssues: 5 }),
      );
    });
  });

  describe('dispatchBudgetExceeded', () => {
    it('should dispatch a budget-exceeded event with fleet scope', async () => {
      await bus.dispatchBudgetExceeded(15000, 10000);
      expect(notifications.dispatch).toHaveBeenCalledWith({
        type: 'budget-exceeded',
        scope: 'fleet',
        currentUsage: 15000,
        budget: 10000,
      });
    });
  });

  describe('dispatchBudgetWarning', () => {
    it('should dispatch a budget-warning event with percentUsed', async () => {
      await bus.dispatchBudgetWarning(8000, 10000, 80);
      expect(notifications.dispatch).toHaveBeenCalledWith({
        type: 'budget-warning',
        scope: 'fleet',
        currentUsage: 8000,
        budget: 10000,
        percentUsed: 80,
      });
    });
  });

  describe('appendFleetStarted', () => {
    it('should append a fleet started event with issue count', async () => {
      await bus.appendFleetStarted(7);
      expect(fleetProgress.appendEvent).toHaveBeenCalledTimes(1);
      expect(fleetProgress.appendEvent).toHaveBeenCalledWith('Fleet started: 7 issues');
    });
  });

  describe('appendFleetCompleted', () => {
    it('should append a fleet completed event with PR and failure counts', async () => {
      await bus.appendFleetCompleted(4, 2);
      expect(fleetProgress.appendEvent).toHaveBeenCalledWith('Fleet completed: 4 PRs, 2 failures');
    });

    it('should handle zero PRs and zero failures', async () => {
      await bus.appendFleetCompleted(0, 0);
      expect(fleetProgress.appendEvent).toHaveBeenCalledWith('Fleet completed: 0 PRs, 0 failures');
    });
  });
});
