import { describe, it, expect } from 'vitest';
import { IssueDag } from '../src/core/issue-dag.js';
import { CyclicDependencyError } from '../src/errors.js';
import type { IssueDetail } from '../src/platform/provider.js';

function makeIssue(number: number): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '',
    updatedAt: '',
    linkedPRs: [],
  };
}

describe('IssueDag', () => {
  describe('empty input', () => {
    it('produces no waves for empty issue list', () => {
      const dag = new IssueDag([], {});
      expect(dag.getWaves()).toEqual([]);
    });
  });

  describe('single issue', () => {
    it('puts a single issue with no deps in wave 0', () => {
      const issue = makeIssue(1);
      const dag = new IssueDag([issue], {});
      const waves = dag.getWaves();
      expect(waves).toHaveLength(1);
      expect(waves[0]).toHaveLength(1);
      expect(waves[0][0].number).toBe(1);
    });
  });

  describe('no dependencies', () => {
    it('puts all issues in a single wave when there are no deps', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const dag = new IssueDag(issues, {});
      const waves = dag.getWaves();
      expect(waves).toHaveLength(1);
      expect(waves[0].map((i) => i.number).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('linear dependency chain (A→B→C, where A depends on B, B depends on C)', () => {
    // Issue 3 (C) has no deps → wave 0
    // Issue 2 (B) depends on 3 → wave 1
    // Issue 1 (A) depends on 2 → wave 2
    it('produces three waves for a linear chain', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const depMap = { 1: [2], 2: [3] };
      const dag = new IssueDag(issues, depMap);
      const waves = dag.getWaves();
      expect(waves).toHaveLength(3);
      expect(waves[0].map((i) => i.number)).toEqual([3]);
      expect(waves[1].map((i) => i.number)).toEqual([2]);
      expect(waves[2].map((i) => i.number)).toEqual([1]);
    });

    it('getTransitiveDepsOrdered returns deps in topological order (deepest first)', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const depMap = { 1: [2], 2: [3] };
      const dag = new IssueDag(issues, depMap);
      const deps = dag.getTransitiveDepsOrdered(1);
      expect(deps.map((i) => i.number)).toEqual([3, 2]);
    });

    it('getTransitiveDepsOrdered returns empty for a leaf issue', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const depMap = { 1: [2], 2: [3] };
      const dag = new IssueDag(issues, depMap);
      const deps = dag.getTransitiveDepsOrdered(3);
      expect(deps).toHaveLength(0);
    });
  });

  describe('diamond dependency (A→B, A→C, B→D, C→D)', () => {
    // Issue 4 (D) has no deps → wave 0
    // Issue 2 (B) and 3 (C) depend on 4 → wave 1
    // Issue 1 (A) depends on 2 and 3 → wave 2
    it('produces correct wave grouping', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3), makeIssue(4)];
      const depMap = { 1: [2, 3], 2: [4], 3: [4] };
      const dag = new IssueDag(issues, depMap);
      const waves = dag.getWaves();
      expect(waves).toHaveLength(3);
      expect(waves[0].map((i) => i.number)).toEqual([4]);
      expect(waves[1].map((i) => i.number).sort()).toEqual([2, 3]);
      expect(waves[2].map((i) => i.number)).toEqual([1]);
    });

    it('getTransitiveDepsOrdered for diamond root returns all transitive deps', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3), makeIssue(4)];
      const depMap = { 1: [2, 3], 2: [4], 3: [4] };
      const dag = new IssueDag(issues, depMap);
      const deps = dag.getTransitiveDepsOrdered(1);
      const depNums = deps.map((i) => i.number);
      // 4 must come before 2 and 3
      expect(depNums).toContain(2);
      expect(depNums).toContain(3);
      expect(depNums).toContain(4);
      expect(depNums.indexOf(4)).toBeLessThan(depNums.indexOf(2));
      expect(depNums.indexOf(4)).toBeLessThan(depNums.indexOf(3));
    });
  });

  describe('cycle detection', () => {
    it('throws CyclicDependencyError for a direct cycle (A depends on B, B depends on A)', () => {
      const issues = [makeIssue(1), makeIssue(2)];
      const depMap = { 1: [2], 2: [1] };
      expect(() => new IssueDag(issues, depMap)).toThrow(CyclicDependencyError);
    });

    it('includes cycle participant issue numbers in the error', () => {
      const issues = [makeIssue(1), makeIssue(2)];
      const depMap = { 1: [2], 2: [1] };
      try {
        new IssueDag(issues, depMap);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CyclicDependencyError);
        const cycleErr = err as CyclicDependencyError;
        expect(cycleErr.issueNumbers.sort()).toEqual([1, 2]);
      }
    });

    it('throws CyclicDependencyError for a longer cycle', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const depMap = { 1: [2], 2: [3], 3: [1] };
      expect(() => new IssueDag(issues, depMap)).toThrow(CyclicDependencyError);
    });

    it('still computes waves for non-cyclic nodes when a cycle exists among others', () => {
      // Issue 4 is independent; 1,2,3 form a cycle
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3), makeIssue(4)];
      const depMap = { 1: [2], 2: [3], 3: [1] };
      expect(() => new IssueDag(issues, depMap)).toThrow(CyclicDependencyError);
    });
  });

  describe('deps not in issue list are ignored', () => {
    it('ignores dep references to unknown issues', () => {
      const issues = [makeIssue(1)];
      const depMap = { 1: [999] }; // 999 not in issues
      const dag = new IssueDag(issues, depMap);
      const waves = dag.getWaves();
      expect(waves).toHaveLength(1);
      expect(waves[0][0].number).toBe(1);
    });
  });

  describe('getDirectDeps', () => {
    it('returns direct dep numbers filtered to the issue set', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const depMap = { 1: [2, 999], 2: [3] }; // 999 not in set
      const dag = new IssueDag(issues, depMap);
      expect(dag.getDirectDeps(1)).toEqual([2]);
      expect(dag.getDirectDeps(2)).toEqual([3]);
      expect(dag.getDirectDeps(3)).toEqual([]);
    });

    it('returns empty array for issue with no deps', () => {
      const issues = [makeIssue(5)];
      const dag = new IssueDag(issues, {});
      expect(dag.getDirectDeps(5)).toEqual([]);
    });
  });

  describe('getAllIssues', () => {
    it('returns all issues in the DAG', () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const dag = new IssueDag(issues, {});
      const all = dag.getAllIssues();
      expect(all.map((i) => i.number).sort()).toEqual([1, 2, 3]);
    });
  });
});
