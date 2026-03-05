import type { IssueDetail } from '../../src/platform/provider.js';

/**
 * Create a mock IssueDetail with sensible defaults.
 * All fields satisfy the IssueDetail interface without `as unknown` casts.
 */
export function makeMockIssue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    number: 42,
    title: 'Test Issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    linkedPRs: [],
    ...overrides,
  };
}
