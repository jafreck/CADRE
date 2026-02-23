import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '../src/platform/provider.js';

describe('PullRequestInfo merged field', () => {
  it('should accept merged: true alongside state', () => {
    const pr: PullRequestInfo = {
      number: 1,
      url: 'https://github.com/owner/repo/pull/1',
      title: 'Fix bug',
      headBranch: 'fix/bug',
      baseBranch: 'main',
      state: 'closed',
      merged: true,
    };
    expect(pr.merged).toBe(true);
    expect(pr.state).toBe('closed');
  });

  it('should accept merged: false alongside state', () => {
    const pr: PullRequestInfo = {
      number: 2,
      url: 'https://github.com/owner/repo/pull/2',
      title: 'Draft feature',
      headBranch: 'feature/x',
      baseBranch: 'main',
      state: 'closed',
      merged: false,
    };
    expect(pr.merged).toBe(false);
  });

  it('should unambiguously distinguish merged from closed-not-merged', () => {
    const mergedPr: PullRequestInfo = {
      number: 10,
      url: 'https://github.com/owner/repo/pull/10',
      title: 'Merged PR',
      headBranch: 'feature/done',
      baseBranch: 'main',
      state: 'closed',
      merged: true,
    };
    const closedPr: PullRequestInfo = {
      number: 11,
      url: 'https://github.com/owner/repo/pull/11',
      title: 'Closed PR',
      headBranch: 'feature/abandoned',
      baseBranch: 'main',
      state: 'closed',
      merged: false,
    };
    expect(mergedPr.merged).toBe(true);
    expect(closedPr.merged).toBe(false);
    expect(mergedPr.state).toBe(closedPr.state);
  });
});
