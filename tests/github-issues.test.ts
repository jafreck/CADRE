import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAPI } from '../src/github/api.js';
import type { Octokit } from '@octokit/rest';
import { Logger } from '../src/logging/logger.js';

describe('GitHubAPI', () => {
  let api: GitHubAPI;
  let mockLogger: Logger;
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    // Mock Octokit REST methods used by GitHubAPI
    mockOctokit = {
      rest: {
        issues: {
          get: vi.fn(),
          listComments: vi.fn(),
          createComment: vi.fn(),
          update: vi.fn(),
          createLabel: vi.fn(),
          addLabels: vi.fn(),
          listForRepo: vi.fn(),
        },
        pulls: {
          create: vi.fn(),
          get: vi.fn(),
          update: vi.fn(),
          list: vi.fn(),
          listReviewComments: vi.fn(),
          listReviews: vi.fn(),
          requestReviewers: vi.fn(),
        },
        users: {
          getAuthenticated: vi.fn(),
        },
        search: {
          issuesAndPullRequests: vi.fn(),
        },
      },
      paginate: vi.fn(),
    } as unknown as Octokit;

    api = new GitHubAPI('owner/repo', mockLogger, mockOctokit);
  });

  describe('getIssue', () => {
    it('should fetch issue details via Octokit', async () => {
      const issueData = {
        number: 42,
        title: 'Fix login',
        body: 'Description',
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'dev1' }],
        state: 'open',
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      };
      vi.mocked(mockOctokit.rest.issues.get).mockResolvedValue({ data: issueData } as never);
      vi.mocked(mockOctokit.rest.issues.listComments).mockResolvedValue({ data: [] } as never);

      const issue = await api.getIssue(42);
      expect(issue).toBeDefined();
      expect(issue.number).toBe(42);
      expect(mockOctokit.rest.issues.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
    });

    it('should include comments from separate Octokit call', async () => {
      vi.mocked(mockOctokit.rest.issues.get).mockResolvedValue({ data: { number: 42, title: 'Fix login' } } as never);
      vi.mocked(mockOctokit.rest.issues.listComments).mockResolvedValue({
        data: [{ body: 'comment 1', user: { login: 'user1' }, created_at: '2024-01-01' }],
      } as never);

      const issue = await api.getIssue(42);
      expect(issue.comments).toHaveLength(1);
    });

    it('should return issue with empty comments when listComments throws', async () => {
      vi.mocked(mockOctokit.rest.issues.get).mockResolvedValue({ data: { number: 42, title: 'Fix login' } } as never);
      vi.mocked(mockOctokit.rest.issues.listComments).mockRejectedValue(new Error('Network error'));

      const issue = await api.getIssue(42);
      expect(issue.comments).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('#42'));
    });
  });

  describe('listIssues', () => {
    it('should fetch issues with filters via Octokit paginate', async () => {
      vi.mocked(mockOctokit.paginate).mockResolvedValue([
        { number: 42, title: 'Issue 1', state: 'open' },
        { number: 57, title: 'Issue 2', state: 'open' },
      ] as never);

      const issues = await api.listIssues({ labels: ['bug'], state: 'open' });
      expect(issues).toHaveLength(2);
      expect(mockOctokit.paginate).toHaveBeenCalledWith(
        mockOctokit.rest.issues.listForRepo,
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          state: 'open',
          labels: 'bug',
        }),
      );
    });

    it('should use search for milestone/assignee filtering', async () => {
      vi.mocked(mockOctokit.paginate).mockResolvedValue([{ number: 42, title: 'Issue 1' }] as never);

      const issues = await api.listIssues({ milestone: 'v1.0', assignee: 'dev1' });
      expect(issues).toHaveLength(1);
      expect(mockOctokit.paginate).toHaveBeenCalledWith(
        mockOctokit.rest.search.issuesAndPullRequests,
        expect.objectContaining({
          q: expect.stringContaining('milestone:"v1.0"'),
        }),
      );
    });
  });

  describe('checkAuth', () => {
    it('should return true when Octokit is authenticated', async () => {
      vi.mocked(mockOctokit.rest.users.getAuthenticated).mockResolvedValue({ data: { login: 'user' } } as never);

      const result = await api.checkAuth();
      expect(result).toBe(true);
    });

    it('should return false when Octokit authentication fails', async () => {
      vi.mocked(mockOctokit.rest.users.getAuthenticated).mockRejectedValue(new Error('Unauthorized'));

      const result = await api.checkAuth();
      expect(result).toBe(false);
    });
  });

  describe('getPRReviewComments', () => {
    it('should call listReviewComments on pulls and return thread-shaped objects', async () => {
      const mockComments = [{ id: 1, body: 'Looks good', in_reply_to_id: undefined, user: { login: 'reviewer' }, created_at: '2024-01-01', path: 'src/foo.ts', line: 10, original_line: 10 }];
      vi.mocked(mockOctokit.rest.pulls.listReviewComments).mockResolvedValue({ data: mockComments } as never);

      const result = await api.getPRReviewComments(42);

      expect(mockOctokit.rest.pulls.listReviewComments).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
      });
      expect(result).toEqual([
        {
          id: '1',
          isResolved: false,
          isOutdated: false,
          comments: [
            {
              id: '1',
              author: { login: 'reviewer' },
              body: 'Looks good',
              createdAt: '2024-01-01',
              path: 'src/foo.ts',
              line: 10,
            },
          ],
        },
      ]);
    });
  });

  describe('ensureLabel', () => {
    it('should call createLabel with default color when no color provided', async () => {
      vi.mocked(mockOctokit.rest.issues.createLabel).mockResolvedValue({ data: {} } as never);

      await api.ensureLabel('cadre-generated');

      expect(mockOctokit.rest.issues.createLabel).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        name: 'cadre-generated',
        color: 'ededed',
      });
    });

    it('should call createLabel with provided color', async () => {
      vi.mocked(mockOctokit.rest.issues.createLabel).mockResolvedValue({ data: {} } as never);

      await api.ensureLabel('bug', 'ff0000');

      expect(mockOctokit.rest.issues.createLabel).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        name: 'bug',
        color: 'ff0000',
      });
    });

    it('should silently ignore 422 already-exists errors', async () => {
      vi.mocked(mockOctokit.rest.issues.createLabel).mockRejectedValue(new Error('422 Unprocessable Entity'));

      await expect(api.ensureLabel('bug')).resolves.toBeUndefined();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should silently ignore errors containing "already exists"', async () => {
      vi.mocked(mockOctokit.rest.issues.createLabel).mockRejectedValue(new Error('Label already exists'));

      await expect(api.ensureLabel('bug')).resolves.toBeUndefined();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should warn for non-422 errors', async () => {
      vi.mocked(mockOctokit.rest.issues.createLabel).mockRejectedValue(new Error('Network error'));

      await api.ensureLabel('bug');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create label "bug"'),
      );
    });
  });

  describe('applyLabels', () => {
    it('should call issues.addLabels with the given labels', async () => {
      vi.mocked(mockOctokit.rest.issues.addLabels).mockResolvedValue({ data: [] } as never);

      await api.applyLabels(42, ['bug', 'enhancement']);

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        labels: ['bug', 'enhancement'],
      });
    });

    it('should add labels without clobbering existing ones (addLabels API handles this)', async () => {
      vi.mocked(mockOctokit.rest.issues.addLabels).mockResolvedValue({ data: [] } as never);

      await api.applyLabels(42, ['cadre-generated']);

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['cadre-generated'] }),
      );
    });

    it('should not call addLabels when labels array is empty', async () => {
      await api.applyLabels(42, []);

      expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it('should warn when addLabels fails', async () => {
      vi.mocked(mockOctokit.rest.issues.addLabels).mockRejectedValue(new Error('Forbidden'));

      await api.applyLabels(42, ['bug']);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to apply labels to PR #42'),
      );
    });
  });

  describe('addIssueComment', () => {
    it('should call issues.createComment with the correct params', async () => {
      vi.mocked(mockOctokit.rest.issues.createComment).mockResolvedValue({ data: {} } as never);

      await api.addIssueComment(42, 'Hello world');

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Hello world',
      });
    });
  });

  describe('getPullRequest', () => {
    it('should return PR data via octokit.rest.pulls.get', async () => {
      const prData = { number: 5, title: 'My PR', state: 'open' };
      vi.mocked(mockOctokit.rest.pulls.get).mockResolvedValue({ data: prData } as never);

      const result = await api.getPullRequest(5);

      expect(result).toEqual(prData);
      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 5,
      });
    });
  });

  describe('updatePullRequest', () => {
    it('should call octokit.rest.pulls.update with provided updates', async () => {
      vi.mocked(mockOctokit.rest.pulls.update).mockResolvedValue({ data: {} } as never);

      await api.updatePullRequest(5, { title: 'New title', body: 'New body' });

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 5,
        title: 'New title',
        body: 'New body',
      });
    });

    it('should call pulls.update with only title when body is omitted', async () => {
      vi.mocked(mockOctokit.rest.pulls.update).mockResolvedValue({ data: {} } as never);

      await api.updatePullRequest(5, { title: 'New title' });

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({ pull_number: 5, title: 'New title' }),
      );
    });
  });

  describe('getPRComments', () => {
    it('should return issue comments for the given PR number', async () => {
      const comments = [{ id: 1, body: 'LGTM' }];
      vi.mocked(mockOctokit.rest.issues.listComments).mockResolvedValue({ data: comments } as never);

      const result = await api.getPRComments(5);

      expect(result).toEqual(comments);
      expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 5,
      });
    });
  });

  describe('getPRReviews', () => {
    it('should return reviews for the given PR number', async () => {
      const reviews = [{ id: 1, state: 'APPROVED', body: 'Ship it' }];
      vi.mocked(mockOctokit.rest.pulls.listReviews).mockResolvedValue({ data: reviews } as never);

      const result = await api.getPRReviews(5);

      expect(result).toEqual(reviews);
      expect(mockOctokit.rest.pulls.listReviews).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 5,
      });
    });
  });

  describe('listPullRequests', () => {
    it('should call pulls.list with no filters when none provided', async () => {
      const prs = [{ number: 1 }, { number: 2 }];
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: prs } as never);

      const result = await api.listPullRequests();

      expect(result).toEqual(prs);
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should prefix owner to head filter', async () => {
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: [] } as never);

      await api.listPullRequests({ head: 'my-branch' });

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({ head: 'owner:my-branch' }),
      );
    });

    it('should pass base and state filters through unchanged', async () => {
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: [] } as never);

      await api.listPullRequests({ base: 'main', state: 'closed' });

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'main', state: 'closed' }),
      );
    });
  });

  describe('getIssue (error paths)', () => {
    it('should return issue with empty comments when listComments throws', async () => {
      vi.mocked(mockOctokit.rest.issues.get).mockResolvedValue({ data: { number: 1 } } as never);
      vi.mocked(mockOctokit.rest.issues.listComments).mockRejectedValue(new Error('Not found'));

      const issue = await api.getIssue(1);

      expect(issue.comments).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('createPullRequest (error paths)', () => {
    it('should warn but not throw when addLabels fails for labels', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 100 } } as never);
      vi.mocked(mockOctokit.rest.issues.addLabels).mockRejectedValue(new Error('Forbidden'));

      await expect(
        api.createPullRequest({ title: 'T', body: 'B', head: 'h', base: 'main', labels: ['bug'] }),
      ).resolves.toBeDefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to set labels on PR #100'));
    });

    it('should warn but not throw when requestReviewers fails', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 101 } } as never);
      vi.mocked(mockOctokit.rest.pulls.requestReviewers).mockRejectedValue(new Error('Forbidden'));

      await expect(
        api.createPullRequest({ title: 'T', body: 'B', head: 'h', base: 'main', reviewers: ['alice'] }),
      ).resolves.toBeDefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to set reviewers on PR #101'));
    });
  });

  describe('addIssueComment', () => {
    it('should call issues.createComment with the given body', async () => {
      vi.mocked(mockOctokit.rest.issues.createComment).mockResolvedValue({ data: {} } as never);

      await api.addIssueComment(42, 'Hello from test');

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Hello from test',
      });
    });
  });

  describe('getPullRequest', () => {
    it('should return PR data from octokit.rest.pulls.get', async () => {
      const prData = { number: 10, title: 'My PR', state: 'open' };
      vi.mocked(mockOctokit.rest.pulls.get).mockResolvedValue({ data: prData } as never);

      const result = await api.getPullRequest(10);

      expect(result).toEqual(prData);
      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 10,
      });
    });
  });

  describe('updatePullRequest', () => {
    it('should call pulls.update with the supplied updates', async () => {
      vi.mocked(mockOctokit.rest.pulls.update).mockResolvedValue({ data: {} } as never);

      await api.updatePullRequest(10, { title: 'New title', body: 'New body' });

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 10,
        title: 'New title',
        body: 'New body',
      });
    });
  });

  describe('getPRComments', () => {
    it('should return issue-style comments via issues.listComments', async () => {
      const comments = [{ id: 1, body: 'Nice work' }];
      vi.mocked(mockOctokit.rest.issues.listComments).mockResolvedValue({ data: comments } as never);

      const result = await api.getPRComments(10);

      expect(result).toEqual(comments);
      expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 10,
      });
    });
  });

  describe('getPRReviews', () => {
    it('should return reviews via pulls.listReviews', async () => {
      const reviews = [{ id: 1, state: 'APPROVED', body: 'LGTM' }];
      vi.mocked(mockOctokit.rest.pulls.listReviews).mockResolvedValue({ data: reviews } as never);

      const result = await api.getPRReviews(10);

      expect(result).toEqual(reviews);
      expect(mockOctokit.rest.pulls.listReviews).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 10,
      });
    });
  });

  describe('listPullRequests', () => {
    it('should return PRs from pulls.list with no filters', async () => {
      const prs = [{ number: 1 }, { number: 2 }];
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: prs } as never);

      const result = await api.listPullRequests();

      expect(result).toEqual(prs);
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should prefix head filter with owner', async () => {
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: [] } as never);

      await api.listPullRequests({ head: 'feature-branch', state: 'open' });

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({
          head: 'owner:feature-branch',
          state: 'open',
        }),
      );
    });

    it('should pass base filter through directly', async () => {
      vi.mocked(mockOctokit.rest.pulls.list).mockResolvedValue({ data: [] } as never);

      await api.listPullRequests({ base: 'main' });

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'main' }),
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create a PR via Octokit', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({
        data: {
          number: 87,
          html_url: 'https://github.com/owner/repo/pull/87',
          title: 'Fix login (#42)',
        },
      } as never);

      const pr = await api.createPullRequest({
        title: 'Fix login (#42)',
        body: 'Closes #42',
        head: 'cadre/issue-42',
        base: 'main',
        draft: true,
      });

      expect(pr.number).toBe(87);
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'Fix login (#42)',
        body: 'Closes #42',
        head: 'cadre/issue-42',
        base: 'main',
        draft: true,
      });
    });

    it('should apply labels via a separate issues.addLabels call after PR creation', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 88 } } as never);
      vi.mocked(mockOctokit.rest.issues.addLabels).mockResolvedValue({ data: [] } as never);

      await api.createPullRequest({
        title: 'Add feature',
        body: 'Adds a feature',
        head: 'feature-branch',
        base: 'main',
        labels: ['enhancement', 'cadre-generated'],
      });

      // Labels are NOT passed to pulls.create
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ labels: expect.anything() }),
      );
      // Labels are applied via issues.addLabels
      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 88,
          labels: ['enhancement', 'cadre-generated'],
        }),
      );
    });

    it('should request reviewers via a separate requestReviewers call after PR creation', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 89 } } as never);
      vi.mocked(mockOctokit.rest.pulls.requestReviewers).mockResolvedValue({ data: {} } as never);

      await api.createPullRequest({
        title: 'Add feature',
        body: 'Adds a feature',
        head: 'feature-branch',
        base: 'main',
        reviewers: ['alice', 'bob'],
      });

      // Reviewers are NOT passed to pulls.create
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ reviewers: expect.anything() }),
      );
      // Reviewers are requested via requestReviewers
      expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
        expect.objectContaining({
          pull_number: 89,
          reviewers: ['alice', 'bob'],
        }),
      );
    });

    it('should apply labels and request reviewers via separate calls after PR creation', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 90 } } as never);
      vi.mocked(mockOctokit.rest.issues.addLabels).mockResolvedValue({ data: [] } as never);
      vi.mocked(mockOctokit.rest.pulls.requestReviewers).mockResolvedValue({ data: {} } as never);

      await api.createPullRequest({
        title: 'Refactor module',
        body: 'Refactors the module',
        head: 'refactor-branch',
        base: 'main',
        labels: ['refactor'],
        reviewers: ['charlie'],
      });

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 90, labels: ['refactor'] }),
      );
      expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
        expect.objectContaining({ pull_number: 90, reviewers: ['charlie'] }),
      );
    });

    it('should omit labels from PR call when labels array is empty', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 91 } } as never);

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
        labels: [],
      });

      const callArgs = vi.mocked(mockOctokit.rest.pulls.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('labels');
      expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it('should omit reviewers from PR call when reviewers array is empty', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 92 } } as never);

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
        reviewers: [],
      });

      const callArgs = vi.mocked(mockOctokit.rest.pulls.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('reviewers');
      expect(mockOctokit.rest.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('should omit labels and reviewers from PR call when neither is provided', async () => {
      vi.mocked(mockOctokit.rest.pulls.create).mockResolvedValue({ data: { number: 93 } } as never);

      await api.createPullRequest({
        title: 'Fix bug',
        body: 'Fixes the bug',
        head: 'fix-branch',
        base: 'main',
      });

      const callArgs = vi.mocked(mockOctokit.rest.pulls.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('labels');
      expect(callArgs).not.toHaveProperty('reviewers');
    });
  });
});
