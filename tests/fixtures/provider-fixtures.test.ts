import { describe, it, expect } from 'vitest';
import {
  FIXTURE_ISSUE,
  FIXTURE_PR,
  FIXTURE_PR_COMMENT,
  FIXTURE_PR_REVIEW,
  FIXTURE_REVIEW_THREAD,
} from './provider-fixtures.js';

describe('FIXTURE_ISSUE', () => {
  it('should conform to IssueDetail with all required fields', () => {
    expect(typeof FIXTURE_ISSUE.number).toBe('number');
    expect(typeof FIXTURE_ISSUE.title).toBe('string');
    expect(typeof FIXTURE_ISSUE.body).toBe('string');
    expect(Array.isArray(FIXTURE_ISSUE.labels)).toBe(true);
    expect(Array.isArray(FIXTURE_ISSUE.assignees)).toBe(true);
    expect(Array.isArray(FIXTURE_ISSUE.comments)).toBe(true);
    expect(Array.isArray(FIXTURE_ISSUE.linkedPRs)).toBe(true);
    expect(typeof FIXTURE_ISSUE.state).toBe('string');
    expect(typeof FIXTURE_ISSUE.createdAt).toBe('string');
    expect(typeof FIXTURE_ISSUE.updatedAt).toBe('string');
  });

  it('should have state "open"', () => {
    expect(FIXTURE_ISSUE.state).toBe('open');
  });

  it('should have number 42', () => {
    expect(FIXTURE_ISSUE.number).toBe(42);
  });

  it('should have at least one label', () => {
    expect(FIXTURE_ISSUE.labels.length).toBeGreaterThan(0);
  });

  it('should have at least one assignee', () => {
    expect(FIXTURE_ISSUE.assignees.length).toBeGreaterThan(0);
  });

  it('should have at least one comment with required fields', () => {
    expect(FIXTURE_ISSUE.comments.length).toBeGreaterThan(0);
    const comment = FIXTURE_ISSUE.comments[0];
    expect(typeof comment.author).toBe('string');
    expect(typeof comment.body).toBe('string');
    expect(typeof comment.createdAt).toBe('string');
  });

  it('should have at least one linked PR', () => {
    expect(FIXTURE_ISSUE.linkedPRs.length).toBeGreaterThan(0);
    expect(typeof FIXTURE_ISSUE.linkedPRs[0]).toBe('number');
  });
});

describe('FIXTURE_PR', () => {
  it('should conform to PullRequestInfo with all required fields', () => {
    expect(typeof FIXTURE_PR.number).toBe('number');
    expect(typeof FIXTURE_PR.url).toBe('string');
    expect(typeof FIXTURE_PR.title).toBe('string');
    expect(typeof FIXTURE_PR.headBranch).toBe('string');
    expect(typeof FIXTURE_PR.baseBranch).toBe('string');
    expect(typeof FIXTURE_PR.state).toBe('string');
  });

  it('should have state "open"', () => {
    expect(FIXTURE_PR.state).toBe('open');
  });

  it('should have a valid URL', () => {
    expect(FIXTURE_PR.url).toMatch(/^https?:\/\//);
  });

  it('should have number 7', () => {
    expect(FIXTURE_PR.number).toBe(7);
  });

  it('should link issue 42 via linkedPRs', () => {
    expect(FIXTURE_ISSUE.linkedPRs).toContain(FIXTURE_PR.number);
  });
});

describe('FIXTURE_PR_COMMENT', () => {
  it('should conform to PRComment with all required fields', () => {
    expect(typeof FIXTURE_PR_COMMENT.id).toBe('string');
    expect(typeof FIXTURE_PR_COMMENT.author).toBe('string');
    expect(typeof FIXTURE_PR_COMMENT.isBot).toBe('boolean');
    expect(typeof FIXTURE_PR_COMMENT.body).toBe('string');
    expect(typeof FIXTURE_PR_COMMENT.createdAt).toBe('string');
    expect(typeof FIXTURE_PR_COMMENT.url).toBe('string');
  });

  it('should have isBot as false', () => {
    expect(FIXTURE_PR_COMMENT.isBot).toBe(false);
  });

  it('should have a valid URL', () => {
    expect(FIXTURE_PR_COMMENT.url).toMatch(/^https?:\/\//);
  });
});

describe('FIXTURE_PR_REVIEW', () => {
  it('should conform to PRReview with all required fields', () => {
    expect(typeof FIXTURE_PR_REVIEW.id).toBe('string');
    expect(typeof FIXTURE_PR_REVIEW.author).toBe('string');
    expect(typeof FIXTURE_PR_REVIEW.isBot).toBe('boolean');
    expect(typeof FIXTURE_PR_REVIEW.body).toBe('string');
    expect(typeof FIXTURE_PR_REVIEW.state).toBe('string');
    expect(typeof FIXTURE_PR_REVIEW.submittedAt).toBe('string');
  });

  it('should have isBot as false', () => {
    expect(FIXTURE_PR_REVIEW.isBot).toBe(false);
  });

  it('should have state "APPROVED"', () => {
    expect(FIXTURE_PR_REVIEW.state).toBe('APPROVED');
  });
});

describe('FIXTURE_REVIEW_THREAD', () => {
  it('should conform to ReviewThread with all required fields', () => {
    expect(typeof FIXTURE_REVIEW_THREAD.id).toBe('string');
    expect(typeof FIXTURE_REVIEW_THREAD.prNumber).toBe('number');
    expect(typeof FIXTURE_REVIEW_THREAD.isResolved).toBe('boolean');
    expect(typeof FIXTURE_REVIEW_THREAD.isOutdated).toBe('boolean');
    expect(Array.isArray(FIXTURE_REVIEW_THREAD.comments)).toBe(true);
  });

  it('should have isResolved as false', () => {
    expect(FIXTURE_REVIEW_THREAD.isResolved).toBe(false);
  });

  it('should have isOutdated as false', () => {
    expect(FIXTURE_REVIEW_THREAD.isOutdated).toBe(false);
  });

  it('should have at least one comment with required fields', () => {
    expect(FIXTURE_REVIEW_THREAD.comments.length).toBeGreaterThan(0);
    const comment = FIXTURE_REVIEW_THREAD.comments[0];
    expect(typeof comment.id).toBe('string');
    expect(typeof comment.author).toBe('string');
    expect(typeof comment.body).toBe('string');
    expect(typeof comment.createdAt).toBe('string');
    expect(typeof comment.path).toBe('string');
  });

  it('should reference the FIXTURE_PR number', () => {
    expect(FIXTURE_REVIEW_THREAD.prNumber).toBe(FIXTURE_PR.number);
  });
});
