import { describe, it, expect } from 'vitest';
import { TokenTracker, TokenUsageDetail } from '../src/budget/token-tracker.js';

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

  describe('recordDetailed', () => {
    it('should store input and output fields on the record', () => {
      const tracker = new TokenTracker();
      const detail: TokenUsageDetail = { input: 1000, output: 500 };
      tracker.recordDetailed(1, 'code-writer', 2, detail);

      const records = tracker.exportRecords();
      expect(records).toHaveLength(1);
      expect(records[0].input).toBe(1000);
      expect(records[0].output).toBe(500);
    });

    it('should set tokens as input + output', () => {
      const tracker = new TokenTracker();
      tracker.recordDetailed(1, 'code-writer', 2, { input: 800, output: 200 });

      expect(tracker.getTotal()).toBe(1000);
    });

    it('should store correct issueNumber, agent, and phase', () => {
      const tracker = new TokenTracker();
      tracker.recordDetailed(42, 'fix-surgeon', 3, { input: 300, output: 100 });

      const records = tracker.exportRecords();
      expect(records[0].issueNumber).toBe(42);
      expect(records[0].agent).toBe('fix-surgeon');
      expect(records[0].phase).toBe(3);
    });

    it('should aggregate correctly with getTotal, getByAgent, getByPhase', () => {
      const tracker = new TokenTracker();
      tracker.record(1, 'issue-analyst', 1, 2000);
      tracker.recordDetailed(1, 'code-writer', 2, { input: 600, output: 400 });

      expect(tracker.getTotal()).toBe(3000);
      expect(tracker.getByAgent()['issue-analyst']).toBe(2000);
      expect(tracker.getByAgent()['code-writer']).toBe(1000);
      expect(tracker.getByPhase()[1]).toBe(2000);
      expect(tracker.getByPhase()[2]).toBe(1000);
    });

    it('should include input/output in exportRecords output', () => {
      const tracker = new TokenTracker();
      tracker.recordDetailed(5, 'test-writer', 3, { input: 450, output: 150 });

      const exported = tracker.exportRecords();
      expect(exported[0].input).toBe(450);
      expect(exported[0].output).toBe(150);
      expect(exported[0].tokens).toBe(600);
    });

    it('should round-trip detailed records through importRecords', () => {
      const tracker = new TokenTracker();
      tracker.recordDetailed(7, 'pr-composer', 4, { input: 700, output: 300 });
      const exported = tracker.exportRecords();

      const tracker2 = new TokenTracker();
      tracker2.importRecords(exported);

      expect(tracker2.getTotal()).toBe(1000);
      const records = tracker2.exportRecords();
      expect(records[0].input).toBe(700);
      expect(records[0].output).toBe(300);
    });
  });

  describe('getRecords', () => {
    it('should return the same records as exportRecords', () => {
      const tracker = setupTracker();
      expect(tracker.getRecords()).toEqual(tracker.exportRecords());
    });

    it('should return an empty array for a new tracker', () => {
      const tracker = new TokenTracker();
      expect(tracker.getRecords()).toEqual([]);
    });

    it('should include detailed records with input/output fields', () => {
      const tracker = new TokenTracker();
      tracker.recordDetailed(1, 'code-writer', 1, { input: 200, output: 100 });
      const records = tracker.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].input).toBe(200);
      expect(records[0].output).toBe(100);
    });
  });
});
