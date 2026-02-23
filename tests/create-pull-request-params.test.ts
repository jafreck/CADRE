import { describe, it, expect } from 'vitest';
import type { CreatePullRequestParams } from '../src/platform/provider.js';

describe('CreatePullRequestParams', () => {
  it('should accept required fields only (backward compatible)', () => {
    const params: CreatePullRequestParams = {
      title: 'Fix bug',
      body: 'Fixes the bug',
      head: 'feature-branch',
      base: 'main',
    };
    expect(params.title).toBe('Fix bug');
    expect(params.labels).toBeUndefined();
    expect(params.reviewers).toBeUndefined();
  });

  it('should accept optional labels field', () => {
    const params: CreatePullRequestParams = {
      title: 'Add feature',
      body: 'Adds a feature',
      head: 'feature-branch',
      base: 'main',
      labels: ['enhancement', 'cadre-generated'],
    };
    expect(params.labels).toEqual(['enhancement', 'cadre-generated']);
  });

  it('should accept optional reviewers field', () => {
    const params: CreatePullRequestParams = {
      title: 'Add feature',
      body: 'Adds a feature',
      head: 'feature-branch',
      base: 'main',
      reviewers: ['alice', 'bob'],
    };
    expect(params.reviewers).toEqual(['alice', 'bob']);
  });

  it('should accept both labels and reviewers together', () => {
    const params: CreatePullRequestParams = {
      title: 'Refactor module',
      body: 'Refactors the module',
      head: 'refactor-branch',
      base: 'main',
      labels: ['refactor'],
      reviewers: ['charlie'],
    };
    expect(params.labels).toEqual(['refactor']);
    expect(params.reviewers).toEqual(['charlie']);
  });

  it('should accept empty arrays for labels and reviewers', () => {
    const params: CreatePullRequestParams = {
      title: 'Empty arrays',
      body: 'Testing empty arrays',
      head: 'some-branch',
      base: 'main',
      labels: [],
      reviewers: [],
    };
    expect(params.labels).toEqual([]);
    expect(params.reviewers).toEqual([]);
  });

  it('should accept all fields including draft, labels, and reviewers', () => {
    const params: CreatePullRequestParams = {
      title: 'Draft PR',
      body: 'Work in progress',
      head: 'wip-branch',
      base: 'main',
      draft: true,
      labels: ['wip'],
      reviewers: ['dave'],
    };
    expect(params.draft).toBe(true);
    expect(params.labels).toContain('wip');
    expect(params.reviewers).toContain('dave');
  });
});
