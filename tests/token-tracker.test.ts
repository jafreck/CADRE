import { describe, it, expect } from 'vitest';
import { TokenTracker } from '../src/budget/token-tracker.js';

describe('TokenTracker', () => {
  function setupTracker(): TokenTracker {
    const tracker = new TokenTracker();
    tracker.record(42, 'issue-analyst', 1, 3000);
    tracker.record(42, 'codebase-scout', 1, 4000);
    tracker.record(42, 'implementation-planner', 2, 5000);
    tracker.record(57, 'issue-analyst', 1, 2000);
    tracker.record(57, 'codebase-scout', 1, 3000);
    return tracker;
  }

  describe('record and getTotal', () => {
    it('should track total tokens', () => {
      const tracker = setupTracker();
      expect(tracker.getTotal()).toBe(17000);
    });

    it('should return 0 for empty tracker', () => {
      const tracker = new TokenTracker();
      expect(tracker.getTotal()).toBe(0);
    });
  });

  describe('getIssueTotal', () => {
    it('should return tokens for a specific issue', () => {
      const tracker = setupTracker();
      expect(tracker.getIssueTotal(42)).toBe(12000);
      expect(tracker.getIssueTotal(57)).toBe(5000);
    });

    it('should return 0 for unknown issue', () => {
      const tracker = setupTracker();
      expect(tracker.getIssueTotal(999)).toBe(0);
    });
  });

  describe('getByAgent', () => {
    it('should aggregate by agent', () => {
      const tracker = setupTracker();
      const byAgent = tracker.getByAgent();
      expect(byAgent['issue-analyst']).toBe(5000);
      expect(byAgent['codebase-scout']).toBe(7000);
      expect(byAgent['implementation-planner']).toBe(5000);
    });
  });

  describe('getByIssue', () => {
    it('should aggregate by issue', () => {
      const tracker = setupTracker();
      const byIssue = tracker.getByIssue();
      expect(byIssue[42]).toBe(12000);
      expect(byIssue[57]).toBe(5000);
    });
  });

  describe('getByPhase', () => {
    it('should aggregate by phase', () => {
      const tracker = setupTracker();
      const byPhase = tracker.getByPhase();
      expect(byPhase[1]).toBe(12000);
      expect(byPhase[2]).toBe(5000);
    });
  });

  describe('checkFleetBudget', () => {
    it('should return ok when no budget set', () => {
      const tracker = setupTracker();
      expect(tracker.checkFleetBudget()).toBe('ok');
    });

    it('should return ok when under 80%', () => {
      const tracker = setupTracker();
      expect(tracker.checkFleetBudget(100000)).toBe('ok');
    });

    it('should return warning when between 80-100%', () => {
      const tracker = setupTracker();
      // 17000 is 85% of 20000
      expect(tracker.checkFleetBudget(20000)).toBe('warning');
    });

    it('should return exceeded when at or over budget', () => {
      const tracker = setupTracker();
      expect(tracker.checkFleetBudget(17000)).toBe('exceeded');
      expect(tracker.checkFleetBudget(15000)).toBe('exceeded');
    });
  });

  describe('checkIssueBudget', () => {
    it('should return ok when no budget set', () => {
      const tracker = setupTracker();
      expect(tracker.checkIssueBudget(42)).toBe('ok');
    });

    it('should check per-issue budget', () => {
      const tracker = setupTracker();
      expect(tracker.checkIssueBudget(42, 50000)).toBe('ok');
      expect(tracker.checkIssueBudget(42, 14000)).toBe('warning');
      expect(tracker.checkIssueBudget(42, 12000)).toBe('exceeded');
    });
  });

  describe('getSummary', () => {
    it('should return a complete summary', () => {
      const tracker = setupTracker();
      const summary = tracker.getSummary();
      expect(summary.total).toBe(17000);
      expect(summary.recordCount).toBe(5);
      expect(Object.keys(summary.byAgent)).toHaveLength(3);
      expect(Object.keys(summary.byIssue)).toHaveLength(2);
      expect(Object.keys(summary.byPhase)).toHaveLength(2);
    });
  });

  describe('exportRecords / importRecords', () => {
    it('should round-trip records', () => {
      const tracker = setupTracker();
      const exported = tracker.exportRecords();

      const tracker2 = new TokenTracker();
      tracker2.importRecords(exported);

      expect(tracker2.getTotal()).toBe(17000);
      expect(tracker2.getIssueTotal(42)).toBe(12000);
    });

    it('should not share state between instances', () => {
      const tracker = setupTracker();
      const exported = tracker.exportRecords();

      const tracker2 = new TokenTracker();
      tracker2.importRecords(exported);

      // Add to original should not affect copy
      tracker.record(42, 'code-writer', 3, 1000);
      expect(tracker2.getTotal()).toBe(17000);
    });
  });

  describe('record with input/output', () => {
    it('should store input and output on TokenRecord when provided', () => {
      const tracker = new TokenTracker();
      tracker.record(42, 'issue-analyst', 1, 3000, 1000, 2000);
      const records = tracker.exportRecords();
      expect(records).toHaveLength(1);
      expect(records[0].input).toBe(1000);
      expect(records[0].output).toBe(2000);
      expect(records[0].tokens).toBe(3000);
    });

    it('should leave input and output undefined when not provided', () => {
      const tracker = new TokenTracker();
      tracker.record(42, 'issue-analyst', 1, 3000);
      const records = tracker.exportRecords();
      expect(records[0].input).toBeUndefined();
      expect(records[0].output).toBeUndefined();
    });
  });
});
