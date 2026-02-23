import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../src/agents/context-builder.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/github/issues.js';
import { Logger } from '../src/logging/logger.js';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';

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
    const task = {
      id: 'task-001',
      name: 'Fix login',
      description: 'Fix the login handler',
      files: ['src/auth/login.ts'],
      dependencies: [],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Login works'],
    };

    const ctx = await builder.buildForCodeWriter(
      42,
      '/tmp/worktree',
      task,
      '/tmp/task-plan.md',
      ['src/auth/login.ts'],
      '/tmp/progress',
    );

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for code-reviewer', async () => {
    const task = {
      id: 'task-001',
      name: 'Fix login',
      description: 'Fix the login handler',
      files: ['src/auth/login.ts'],
      dependencies: [],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Login works'],
    };

    const ctx = await builder.buildForCodeReviewer(
      42,
      '/tmp/worktree',
      task,
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

  describe('outputSchema inclusion', () => {
    const task = {
      id: 'task-001',
      name: 'Fix login',
      description: 'Fix the login handler',
      files: ['src/auth/login.ts'],
      dependencies: [],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Login works'],
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
    const task = {
      id: 'task-001',
      name: 'Fix login',
      description: 'Fix the login handler',
      files: ['src/auth/login.ts'],
      dependencies: [],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Login works'],
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

    it('should always include taskId, files, and acceptanceCriteria in payload regardless of siblingFiles', async () => {
      await builder.buildForCodeWriter(42, '/tmp/worktree', task, '/tmp/task-plan.md', [], '/tmp/progress', ['src/other.ts']);
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.taskId).toBe(task.id);
      expect(payload.files).toEqual(task.files);
      expect(payload.acceptanceCriteria).toEqual(task.acceptanceCriteria);
    });
  });

  describe('outputSchema exclusions', () => {
    const task = {
      id: 'task-001',
      name: 'Fix login',
      description: 'Fix the login handler',
      files: ['src/auth/login.ts'],
      dependencies: [],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Login works'],
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
});
