import { describe, it, expect } from 'vitest';
import { MockPlatformProvider } from './helpers/mock-platform-provider.js';

describe('MockPlatformProvider', () => {
  it('should have name "Mock"', () => {
    const provider = new MockPlatformProvider();
    expect(provider.name).toBe('Mock');
  });

  it('connect() resolves without error', async () => {
    const provider = new MockPlatformProvider();
    await expect(provider.connect()).resolves.toBeUndefined();
  });

  it('disconnect() resolves without error', async () => {
    const provider = new MockPlatformProvider();
    await expect(provider.disconnect()).resolves.toBeUndefined();
  });

  it('checkAuth() resolves to true', async () => {
    const provider = new MockPlatformProvider();
    await expect(provider.checkAuth()).resolves.toBe(true);
  });

  it('getIssue() returns a valid IssueDetail with correct number', async () => {
    const provider = new MockPlatformProvider();
    const issue = await provider.getIssue(42);
    expect(issue.number).toBe(42);
    expect(typeof issue.title).toBe('string');
    expect(Array.isArray(issue.labels)).toBe(true);
    expect(Array.isArray(issue.comments)).toBe(true);
    expect(Array.isArray(issue.linkedPRs)).toBe(true);
    expect(issue.state).toBe('open');
  });

  it('getIssue() returns default fields when no override provided', async () => {
    const provider = new MockPlatformProvider();
    const issue = await provider.getIssue(1);
    expect(issue.title).toBe('Mock Issue');
    expect(issue.body).toBe('Mock issue body');
  });

  it('constructor issueDetail override is used by getIssue()', async () => {
    const provider = new MockPlatformProvider({ title: 'Custom Title', body: 'Custom body' });
    const issue = await provider.getIssue(7);
    expect(issue.number).toBe(7);
    expect(issue.title).toBe('Custom Title');
    expect(issue.body).toBe('Custom body');
  });

  it('listIssues() returns empty array', async () => {
    const provider = new MockPlatformProvider();
    const issues = await provider.listIssues({});
    expect(issues).toEqual([]);
  });

  it('addIssueComment() resolves without error', async () => {
    const provider = new MockPlatformProvider();
    await expect(provider.addIssueComment(1, 'Hello')).resolves.toBeUndefined();
  });

  it('createPullRequest() returns a PullRequestInfo with plausible fields', async () => {
    const provider = new MockPlatformProvider();
    const pr = await provider.createPullRequest({
      title: 'My PR',
      body: 'PR body',
      head: 'feature-branch',
      base: 'main',
    });
    expect(typeof pr.number).toBe('number');
    expect(typeof pr.url).toBe('string');
    expect(pr.title).toBe('My PR');
    expect(pr.headBranch).toBe('feature-branch');
    expect(pr.baseBranch).toBe('main');
  });

  it('getPullRequest() returns a PullRequestInfo with correct number', async () => {
    const provider = new MockPlatformProvider();
    const pr = await provider.getPullRequest(99);
    expect(pr.number).toBe(99);
    expect(typeof pr.url).toBe('string');
    expect(typeof pr.title).toBe('string');
  });

  it('updatePullRequest() resolves without error', async () => {
    const provider = new MockPlatformProvider();
    await expect(
      provider.updatePullRequest(1, { title: 'New Title' }),
    ).resolves.toBeUndefined();
  });

  it('listPullRequests() returns empty array', async () => {
    const provider = new MockPlatformProvider();
    const prs = await provider.listPullRequests();
    expect(prs).toEqual([]);
  });

  it('issueLinkSuffix() returns "Closes #N"', () => {
    const provider = new MockPlatformProvider();
    expect(provider.issueLinkSuffix(11)).toBe('Closes #11');
    expect(provider.issueLinkSuffix(0)).toBe('Closes #0');
    expect(provider.issueLinkSuffix(100)).toBe('Closes #100');
  });
});
