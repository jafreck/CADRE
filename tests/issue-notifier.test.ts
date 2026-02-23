import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueNotifier } from '../src/core/issue-notifier.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { PlatformProvider } from '../src/platform/provider.js';
import type { Logger } from '../src/logging/logger.js';

function makeMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeMockPlatform(): PlatformProvider {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlatformProvider;
}

function makeConfig(issueUpdates: Partial<CadreConfig['issueUpdates']> = {}): CadreConfig {
  return {
    projectName: 'test',
    repository: 'owner/repo',
    platform: 'github',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [1] },
    commits: { signOff: false },
    agents: { backend: 'claude', model: 'claude-sonnet-4-5' },
    issueUpdates: {
      enabled: true,
      onStart: true,
      onPhaseComplete: true,
      onComplete: true,
      onFailed: true,
      onBudgetWarning: true,
      ...issueUpdates,
    },
  } as unknown as CadreConfig;
}

describe('IssueNotifier', () => {
  let platform: PlatformProvider;
  let logger: Logger;

  beforeEach(() => {
    platform = makeMockPlatform();
    logger = makeMockLogger();
  });

  describe('notifyStart', () => {
    it('should post a comment when enabled and onStart is true', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyStart(42, 'Fix the bug');
      expect(platform.addIssueComment).toHaveBeenCalledOnce();
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(42);
      expect(body).toContain('#42');
      expect(body).toContain('Fix the bug');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyStart(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should not post when onStart is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ onStart: false }), platform, logger);
      await notifier.notifyStart(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyStart(1, 'Issue')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyPhaseComplete', () => {
    it('should post a comment with phase info and duration', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyPhaseComplete(5, 2, 'Planning', 3500);
      expect(platform.addIssueComment).toHaveBeenCalledOnce();
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(5);
      expect(body).toContain('Phase 2');
      expect(body).toContain('Planning');
      expect(body).toContain('3.5s');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyPhaseComplete(1, 1, 'Analysis', 1000);
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should not post when onPhaseComplete is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ onPhaseComplete: false }), platform, logger);
      await notifier.notifyPhaseComplete(1, 1, 'Analysis', 1000);
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyPhaseComplete(1, 1, 'Analysis', 1000)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyComplete', () => {
    it('should post a comment with issue number and title', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyComplete(10, 'My Feature');
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(10);
      expect(body).toContain('#10');
      expect(body).toContain('My Feature');
    });

    it('should include PR URL when provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyComplete(10, 'My Feature', 'https://github.com/owner/repo/pull/99');
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('https://github.com/owner/repo/pull/99');
    });

    it('should omit PR URL section when not provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyComplete(10, 'My Feature');
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).not.toContain('Pull Request');
    });

    it('should include token usage when provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyComplete(10, 'My Feature', undefined, 12345);
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('12');
    });

    it('should omit token usage section when not provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyComplete(10, 'My Feature');
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).not.toContain('Tokens used');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyComplete(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should not post when onComplete is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ onComplete: false }), platform, logger);
      await notifier.notifyComplete(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyComplete(1, 'Issue')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyFailed', () => {
    it('should post a comment with issue number and title', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyFailed(3, 'Broken Feature');
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(3);
      expect(body).toContain('#3');
      expect(body).toContain('Broken Feature');
    });

    it('should include phase info when provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyFailed(3, 'Broken Feature', { id: 2, name: 'Planning' });
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('Phase 2');
      expect(body).toContain('Planning');
    });

    it('should include failed task when provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyFailed(3, 'Broken Feature', undefined, 'task-003');
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('task-003');
    });

    it('should include error message when provided', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyFailed(3, 'Broken Feature', undefined, undefined, 'Something went wrong');
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('Something went wrong');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyFailed(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should not post when onFailed is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ onFailed: false }), platform, logger);
      await notifier.notifyFailed(1, 'Issue');
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyFailed(1, 'Issue')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyAmbiguities', () => {
    it('should post a comment containing each ambiguity item', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyAmbiguities(12, ['Ambiguity one', 'Ambiguity two']);
      expect(platform.addIssueComment).toHaveBeenCalledOnce();
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(12);
      expect(body).toContain('Ambiguity one');
      expect(body).toContain('Ambiguity two');
    });

    it('should format ambiguities as a markdown list', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyAmbiguities(12, ['Item A', 'Item B']);
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body).toContain('- Item A');
      expect(body).toContain('- Item B');
    });

    it('should request clarification in the comment body', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyAmbiguities(12, ['Something unclear']);
      const [, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body.toLowerCase()).toContain('clarification');
    });

    it('should reference the issue number in the comment body', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyAmbiguities(99, ['Some ambiguity']);
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(99);
      expect(body).toContain('#99');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyAmbiguities(1, ['Ambiguity']);
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyAmbiguities(1, ['Some ambiguity'])).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyBudgetWarning', () => {
    it('should post a comment with token counts and percentage', async () => {
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await notifier.notifyBudgetWarning(7, 8000, 10000);
      const [issueNum, body] = (platform.addIssueComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(issueNum).toBe(7);
      expect(body).toContain('#7');
      expect(body).toContain('8');
      expect(body).toContain('10');
      expect(body).toContain('80%');
    });

    it('should not post when enabled is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ enabled: false }), platform, logger);
      await notifier.notifyBudgetWarning(1, 5000, 10000);
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should not post when onBudgetWarning is false', async () => {
      const notifier = new IssueNotifier(makeConfig({ onBudgetWarning: false }), platform, logger);
      await notifier.notifyBudgetWarning(1, 5000, 10000);
      expect(platform.addIssueComment).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when addIssueComment rejects', async () => {
      (platform.addIssueComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      const notifier = new IssueNotifier(makeConfig(), platform, logger);
      await expect(notifier.notifyBudgetWarning(1, 5000, 10000)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
