import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../src/agents/context-builder.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/github/issues.js';
import type { ReviewThread } from '../src/platform/provider.js';
import type { AgentSession } from '../src/agents/types.js';
import { Logger } from '../src/logging/logger.js';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('ContextBuilder', () => {
  let builder: ContextBuilder;
  let mockConfig: CadreConfig;
  let mockIssue: IssueDetail;

  beforeEach(() => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockConfig = {
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      issues: { ids: [42] },
      branchTemplate: 'cadre/issue-{issue}',
      commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
      pullRequest: { autoCreate: true, draft: true, labels: ['cadre-generated'], reviewers: [], linkIssue: true },
      options: {
        maxParallelIssues: 3,
        maxParallelAgents: 3,
        maxRetriesPerTask: 3,
        dryRun: false,
        resume: false,
        invocationDelayMs: 0,
        buildVerification: true,
        testVerification: true,
      },
      commands: { install: 'npm install', build: 'npm run build', test: 'npm test' },
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
      environment: { inheritShellPath: true, extraPath: [] },
    } as CadreConfig;

    mockIssue = {
      number: 42,
      title: 'Fix login',
      body: 'Fix the login handler',
      labels: ['bug'],
      assignees: [],
      comments: [],
      state: 'open',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      linkedPRs: [],
    };

    builder = new ContextBuilder(mockConfig, mockLogger);

    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    // Default: files do not exist
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
  });

  /** Helper: returns the context object written by the last writeFile call. */
  function captureWrittenContext(): Record<string, unknown> {
    const calls = vi.mocked(writeFile).mock.calls;
    const lastCall = calls[calls.length - 1];
    return JSON.parse(lastCall[1] as string) as Record<string, unknown>;
  }

  it('should build context for issue-analyst', async () => {
    const ctx = await builder.buildForIssueAnalyst(
      42,
      '/tmp/worktree',
      '/tmp/issue.json',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for codebase-scout', async () => {
    const ctx = await builder.buildForCodebaseScout(
      42,
      '/tmp/worktree',
      '/tmp/analysis.md',
      '/tmp/file-tree.txt',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for implementation-planner', async () => {
    const ctx = await builder.buildForImplementationPlanner(
      42,
      '/tmp/worktree',
      '/tmp/analysis.md',
      '/tmp/scout-report.md',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for code-writer', async () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    const ctx = await builder.buildForCodeWriter(
      42,
      '/tmp/worktree',
      session,
      '/tmp/task-plan.md',
      ['src/auth/login.ts'],
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for code-reviewer', async () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    const ctx = await builder.buildForCodeReviewer(
      42,
      '/tmp/worktree',
      session,
      '/tmp/diff.patch',
      '/tmp/task-plan.md',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for pr-composer', async () => {
    const ctx = await builder.buildForPRComposer(
      42,
      '/tmp/worktree',
      mockIssue,
      '/tmp/analysis.md',
      '/tmp/plan.md',
      '/tmp/integration.md',
      '/tmp/diff.patch',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for dep-conflict-resolver with dependency metadata', async () => {
    const ctx = await builder.buildForDependencyConflictResolver(
      42,
      '/tmp/deps-worktree',
      ['src/a.ts', 'src/b.ts'],
      'cadre/issue-1',
      'cadre/deps-42',
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');

    const written = captureWrittenContext();
    expect(written.agent).toBe('dep-conflict-resolver');
    expect(written.outputPath).toBe('/tmp/progress/dep-conflict-resolution-report.md');
    expect(written.inputFiles).toEqual(['/tmp/deps-worktree/src/a.ts', '/tmp/deps-worktree/src/b.ts']);

    const payload = written.payload as Record<string, unknown>;
    expect(payload.conflictedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(payload.conflictingBranch).toBe('cadre/issue-1');
    expect(payload.depsBranch).toBe('cadre/deps-42');
    expect(payload.baseBranch).toBe('main');
  });

  describe('outputSchema inclusion', () => {
    const task: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    it('should include outputSchema for issue-analyst', async () => {
      await builder.buildForIssueAnalyst(42, '/tmp/worktree', '/tmp/issue.json', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for codebase-scout', async () => {
      await builder.buildForCodebaseScout(42, '/tmp/worktree', '/tmp/analysis.md', '/tmp/file-tree.txt', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for implementation-planner', async () => {
      await builder.buildForImplementationPlanner(42, '/tmp/worktree', '/tmp/analysis.md', '/tmp/scout.md', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for adjudicator', async () => {
      await builder.buildForAdjudicator(42, '/tmp/worktree', ['/tmp/plan1.md'], '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for code-reviewer', async () => {
      await builder.buildForCodeReviewer(42, '/tmp/worktree', task, '/tmp/diff.patch', '/tmp/task-plan.md', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for integration-checker', async () => {
      await builder.buildForIntegrationChecker(42, '/tmp/worktree', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for pr-composer', async () => {
      await builder.buildForPRComposer(42, '/tmp/worktree', mockIssue, '/tmp/analysis.md', '/tmp/plan.md', '/tmp/integration.md', '/tmp/diff.patch', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should NOT include outputSchema for code-writer', async () => {
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeUndefined();
    });
  });

  describe('buildForCodeWriter siblingFiles', () => {
    const task: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    it('should include siblingFiles in payload when provided and non-empty', async () => {
      const siblingFiles = ['src/auth/utils.ts', 'src/config.ts'];
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress', siblingFiles);
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toEqual(siblingFiles);
    });

    it('should not include siblingFiles in payload when omitted', async () => {
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress');
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toBeUndefined();
    });

    it('should not include siblingFiles in payload when passed as empty array', async () => {
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress', []);
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toBeUndefined();
    });

    it('should always include sessionId and steps in payload regardless of siblingFiles', async () => {
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress', ['src/other.ts']);
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.sessionId).toBe(task.id);
      expect(Array.isArray(payload.steps)).toBe(true);
    });
  });

  describe('outputSchema exclusions', () => {
    const task: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    it('should NOT include outputSchema for test-writer', async () => {
      await builder.buildForTestWriter(42, '/tmp/worktree', task, [], '/tmp/task-plan.md', '/tmp/progress');
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeUndefined();
    });

    it('should NOT include outputSchema for fix-surgeon', async () => {
      await builder.buildForFixSurgeon(42, '/tmp/worktree', task.id, '/tmp/feedback.md', [], '/tmp/progress', 'review', 3);
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeUndefined();
    });
  });

  describe('conditional inputFiles injection', () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Fix login handler',
        description: 'Fix the login handler',
        files: ['src/auth/login.ts'],
        complexity: 'simple' as const,
        acceptanceCriteria: ['Login works'],
      }],
    };

    describe('buildForCodeWriter', () => {
      it('includes analysis.md and scout-report.md in inputFiles when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForCodeWriter(42, '/tmp/worktree', session, '/tmp/task-plan.md', [], '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md from inputFiles when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForCodeWriter(42, '/tmp/worktree', session, '/tmp/task-plan.md', [], '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });
    });

    describe('buildForCodeReviewer', () => {
      it('includes analysis.md and scout-report.md in inputFiles when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForCodeReviewer(42, '/tmp/worktree', session, '/tmp/diff.patch', '/tmp/task-plan.md', '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md from inputFiles when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForCodeReviewer(42, '/tmp/worktree', session, '/tmp/diff.patch', '/tmp/task-plan.md', '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });
    });

    describe('buildForFixSurgeon', () => {
      it('includes phase-3 session plan when phase===3 and file exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForFixSurgeon(42, '/tmp/worktree', 'session-001', '/tmp/feedback.md', [], '/tmp/progress', 'review', 3);
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/session-session-001.md');
        expect(inputFiles).not.toContain('/tmp/progress/implementation-plan.md');
      });

      it('includes implementation-plan.md when phase===4 and file exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForFixSurgeon(42, '/tmp/worktree', 'session-001', '/tmp/feedback.md', [], '/tmp/progress', 'review', 4);
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/implementation-plan.md');
        expect(inputFiles).not.toContain('/tmp/progress/session-session-001.md');
      });

      it('excludes plan file from inputFiles when it does not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForFixSurgeon(42, '/tmp/worktree', 'session-001', '/tmp/feedback.md', [], '/tmp/progress', 'review', 3);
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/session-session-001.md');
      });

      it('includes analysis.md and scout-report.md when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForFixSurgeon(42, '/tmp/worktree', 'session-001', '/tmp/feedback.md', [], '/tmp/progress', 'review', 3);
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForFixSurgeon(42, '/tmp/worktree', 'session-001', '/tmp/feedback.md', [], '/tmp/progress', 'review', 3);
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });
    });

    describe('buildForIntegrationChecker', () => {
      it('includes baseline-results.json in inputFiles when it exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForIntegrationChecker(42, '/tmp/worktree', '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/worktree/.cadre/baseline-results.json');
      });

      it('excludes baseline-results.json from inputFiles when it does not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForIntegrationChecker(42, '/tmp/worktree', '/tmp/progress');
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/worktree/.cadre/baseline-results.json');
      });
    });

    describe('buildForWholePrCodeReviewer', () => {
      it('returns a string path', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        const result = await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        expect(typeof result).toBe('string');
      });

      it('does NOT include diffPath in inputFiles; sets fullDiffPath in payload', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          ['/tmp/progress/session-001.md', '/tmp/progress/session-002.md'],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/whole-pr-diff.patch');
        expect(inputFiles).toContain('/tmp/progress/session-001.md');
        expect(inputFiles).toContain('/tmp/progress/session-002.md');
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.fullDiffPath).toBe('/tmp/whole-pr-diff.patch');
      });

      it('conditionally includes analysis.md, scout-report.md, and implementation-plan.md when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
        expect(inputFiles).toContain('/tmp/progress/implementation-plan.md');
      });

      it('excludes analysis.md, scout-report.md, and implementation-plan.md when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
        expect(inputFiles).not.toContain('/tmp/progress/implementation-plan.md');
      });

      it('includes outputSchema in context', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        expect(ctx.outputSchema).toBeDefined();
        expect(typeof ctx.outputSchema).toBe('object');
      });

      it('sets payload.scope to "whole-pr", payload.baseBranch to config.baseBranch, and includes sessionSummaries', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        const sessionSummaries = [
          { sessionId: 'session-001', verdict: 'pass' as const, summary: 'All good', keyFindings: [] },
        ];
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
          sessionSummaries,
        );
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.scope).toBe('whole-pr');
        expect(payload.baseBranch).toBe('main');
        expect(payload.sessionSummaries).toEqual(sessionSummaries);
      });

      it('defaults sessionSummaries to empty array when not provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(Array.isArray(payload.sessionSummaries)).toBe(true);
        expect((payload.sessionSummaries as unknown[]).length).toBe(0);
      });

      it('sets agent to "whole-pr-reviewer" and phase to 3', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.buildForWholePrCodeReviewer(
          42,
          '/tmp/worktree',
          '/tmp/whole-pr-diff.patch',
          [],
          '/tmp/progress',
        );
        const ctx = captureWrittenContext();
        expect(ctx.agent).toBe('whole-pr-reviewer');
        expect(ctx.phase).toBe(3);
      });
    });
  });

  describe('buildForReviewResponse', () => {
    const makeThread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
      id: 'thread-1',
      prNumber: 10,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          id: 'comment-1',
          author: 'alice',
          body: 'Please fix this.',
          createdAt: '2024-01-01',
          path: 'src/auth/login.ts',
          line: 42,
        },
      ],
      ...overrides,
    });

    it('should return a string with ## Review Comments section', () => {
      const result = builder.buildForReviewResponse(mockIssue, [makeThread()]);
      expect(result).toContain('## Review Comments');
    });

    it('should include file path, author, and body for unresolved threads', () => {
      const result = builder.buildForReviewResponse(mockIssue, [makeThread()]);
      expect(result).toContain('src/auth/login.ts');
      expect(result).toContain('alice');
      expect(result).toContain('Please fix this.');
    });

    it('should omit resolved threads', () => {
      const result = builder.buildForReviewResponse(mockIssue, [makeThread({ isResolved: true })]);
      expect(result).not.toContain('alice');
      expect(result).not.toContain('Please fix this.');
    });

    it('should omit outdated threads', () => {
      const result = builder.buildForReviewResponse(mockIssue, [makeThread({ isOutdated: true })]);
      expect(result).not.toContain('alice');
      expect(result).not.toContain('Please fix this.');
    });

    it('should handle empty thread list', () => {
      const result = builder.buildForReviewResponse(mockIssue, []);
      expect(result).toContain('## Review Comments');
      expect(result).not.toContain('alice');
    });

    it('should include multiple active threads', () => {
      const thread2 = makeThread({
        id: 'thread-2',
        comments: [
          {
            id: 'comment-2',
            author: 'bob',
            body: 'Another issue here.',
            createdAt: '2024-01-02',
            path: 'src/config.ts',
          },
        ],
      });
      const result = builder.buildForReviewResponse(mockIssue, [makeThread(), thread2]);
      expect(result).toContain('alice');
      expect(result).toContain('bob');
      expect(result).toContain('src/auth/login.ts');
      expect(result).toContain('src/config.ts');
    });
  });
});
