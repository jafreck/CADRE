import { describe, it, expect } from 'vitest';
import { TokenTracker } from '../../../../packages/agent-runtime/src/budget/token-tracker.js';
import type { TokenRecord, TokenSummary } from '../../../../packages/agent-runtime/src/budget/token-tracker.js';

describe('TokenTracker (agent-runtime)', () => {
  function setupTracker(): TokenTracker {
    const tracker = new TokenTracker();
    tracker.record(1, 'alpha', 1, 100);
    tracker.record(1, 'beta', 2, 200);
    tracker.record(2, 'alpha', 1, 300, 100, 200);
    return tracker;
  }

  describe('record and getTotal', () => {
    it('should return 0 for a fresh tracker', () => {
      expect(new TokenTracker().getTotal()).toBe(0);
    });

    it('should sum all recorded tokens', () => {
      expect(setupTracker().getTotal()).toBe(600);
    });
  });

  describe('getIssueTotal', () => {
    it('should return tokens for a known issue', () => {
      const tracker = setupTracker();
      expect(tracker.getIssueTotal(1)).toBe(300);
      expect(tracker.getIssueTotal(2)).toBe(300);
    });

    it('should return 0 for an unknown issue', () => {
      expect(setupTracker().getIssueTotal(999)).toBe(0);
    });
  });

  describe('getByAgent', () => {
    it('should aggregate tokens by agent name', () => {
      const byAgent = setupTracker().getByAgent();
      expect(byAgent['alpha']).toBe(400);
      expect(byAgent['beta']).toBe(200);
    });
  });

  describe('getByIssue', () => {
    it('should aggregate tokens by issue number', () => {
      const byIssue = setupTracker().getByIssue();
      expect(byIssue[1]).toBe(300);
      expect(byIssue[2]).toBe(300);
    });
  });

  describe('getByPhase', () => {
    it('should aggregate tokens by phase', () => {
      const byPhase = setupTracker().getByPhase();
      expect(byPhase[1]).toBe(400);
      expect(byPhase[2]).toBe(200);
    });
  });

  describe('checkFleetBudget', () => {
    it('should return ok when no budget is set', () => {
      expect(setupTracker().checkFleetBudget()).toBe('ok');
    });

    it('should return ok when budget is undefined', () => {
      expect(setupTracker().checkFleetBudget(undefined)).toBe('ok');
    });

    it('should return ok when usage is under 80%', () => {
      expect(setupTracker().checkFleetBudget(10000)).toBe('ok');
    });

    it('should return warning when usage is between 80% and 100%', () => {
      // 600 is 80% of 750
      expect(setupTracker().checkFleetBudget(750)).toBe('warning');
    });

    it('should return exceeded when usage equals the budget', () => {
      expect(setupTracker().checkFleetBudget(600)).toBe('exceeded');
    });

    it('should return exceeded when usage exceeds the budget', () => {
      expect(setupTracker().checkFleetBudget(500)).toBe('exceeded');
    });

    it('should return ok when budget is 0 (falsy)', () => {
      expect(setupTracker().checkFleetBudget(0)).toBe('ok');
    });
  });

  describe('checkIssueBudget', () => {
    it('should return ok when no budget is set', () => {
      expect(setupTracker().checkIssueBudget(1)).toBe('ok');
    });

    it('should return ok when under 80%', () => {
      expect(setupTracker().checkIssueBudget(1, 10000)).toBe('ok');
    });

    it('should return warning at 80% threshold', () => {
      // issue 1 has 300; 300 / 375 = 0.8
      expect(setupTracker().checkIssueBudget(1, 375)).toBe('warning');
    });

    it('should return exceeded when at budget', () => {
      expect(setupTracker().checkIssueBudget(1, 300)).toBe('exceeded');
    });
  });

  describe('getSummary', () => {
    it('should return a complete summary object', () => {
      const summary: TokenSummary = setupTracker().getSummary();
      expect(summary.total).toBe(600);
      expect(summary.recordCount).toBe(3);
      expect(Object.keys(summary.byAgent)).toHaveLength(2);
      expect(Object.keys(summary.byIssue)).toHaveLength(2);
      expect(Object.keys(summary.byPhase)).toHaveLength(2);
    });
  });

  describe('exportRecords / importRecords', () => {
    it('should round-trip records between tracker instances', () => {
      const tracker = setupTracker();
      const exported: TokenRecord[] = tracker.exportRecords();

      const tracker2 = new TokenTracker();
      tracker2.importRecords(exported);

      expect(tracker2.getTotal()).toBe(600);
      expect(tracker2.getIssueTotal(1)).toBe(300);
    });

    it('should produce independent copies of the records array', () => {
      const tracker = setupTracker();
      const exported = tracker.exportRecords();
      const tracker2 = new TokenTracker();
      tracker2.importRecords(exported);

      tracker.record(1, 'gamma', 3, 500);
      expect(tracker2.getTotal()).toBe(600);
    });

    it('should export records with input/output fields when provided', () => {
      const records = setupTracker().exportRecords();
      const withIO = records.find((r) => r.input !== undefined);
      expect(withIO).toBeDefined();
      expect(withIO!.input).toBe(100);
      expect(withIO!.output).toBe(200);
    });

    it('should export records with undefined input/output when not provided', () => {
      const records = setupTracker().exportRecords();
      const withoutIO = records.find((r) => r.agent === 'alpha' && r.issueNumber === 1);
      expect(withoutIO!.input).toBeUndefined();
      expect(withoutIO!.output).toBeUndefined();
    });
  });

  describe('record with input/output tokens', () => {
    it('should store input and output on the record', () => {
      const tracker = new TokenTracker();
      tracker.record(10, 'agent', 1, 500, 200, 300);
      const records = tracker.exportRecords();
      expect(records[0].input).toBe(200);
      expect(records[0].output).toBe(300);
      expect(records[0].tokens).toBe(500);
    });
  });

  describe('timestamp', () => {
    it('should include an ISO timestamp on each record', () => {
      const tracker = new TokenTracker();
      tracker.record(1, 'test', 1, 100);
      const records = tracker.exportRecords();
      expect(records[0].timestamp).toBeTruthy();
      // Validate ISO 8601 format
      expect(new Date(records[0].timestamp).toISOString()).toBe(records[0].timestamp);
    });
  });
});
