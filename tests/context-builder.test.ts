import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder, AGENT_CONTEXT_REGISTRY } from '../src/agents/context-builder.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/github/issues.js';
import type { ReviewThread } from '../src/platform/provider.js';
import type { AgentSession, AgentName } from '../src/agents/types.js';
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
    const ctx = await builder.build('issue-analyst', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      issueJsonPath: '/tmp/issue.json',
      progressDir: '/tmp/progress',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for codebase-scout', async () => {
    const ctx = await builder.build('codebase-scout', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      analysisPath: '/tmp/analysis.md',
      fileTreePath: '/tmp/file-tree.txt',
      progressDir: '/tmp/progress',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for dependency-analyst', async () => {
    const ctx = await builder.build('dependency-analyst', {
      issueNumber: 0,
      worktreePath: '/tmp/worktree',
      progressDir: '/tmp/progress',
      dependencyIssues: [{ number: 1 }, { number: 2 }],
      dependencyHint: 'avoid cycles',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');

    const written = captureWrittenContext();
    expect(written.agent).toBe('dependency-analyst');
    expect(written.outputPath).toBe('/tmp/progress/dep-map.md');
    expect(written.inputFiles).toEqual([]);
    expect(written.outputSchema).toEqual({
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'number' },
      },
    });
    expect(written.payload).toEqual({
      issues: [{ number: 1 }, { number: 2 }],
      hint: 'avoid cycles',
    });
  });

  it('should build context for implementation-planner', async () => {
    const ctx = await builder.build('implementation-planner', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      analysisPath: '/tmp/analysis.md',
      scoutReportPath: '/tmp/scout-report.md',
      progressDir: '/tmp/progress',
    });

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

    const ctx = await builder.build('code-writer', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      session,
      sessionPlanPath: '/tmp/task-plan.md',
      relevantFiles: ['src/auth/login.ts'],
      progressDir: '/tmp/progress',
    });

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

    const ctx = await builder.build('code-reviewer', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      session,
      diffPath: '/tmp/diff.patch',
      sessionPlanPath: '/tmp/task-plan.md',
      progressDir: '/tmp/progress',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for pr-composer', async () => {
    const ctx = await builder.build('pr-composer', {
      issueNumber: 42,
      worktreePath: '/tmp/worktree',
      issue: mockIssue,
      analysisPath: '/tmp/analysis.md',
      planPath: '/tmp/plan.md',
      integrationReportPath: '/tmp/integration.md',
      diffPath: '/tmp/diff.patch',
      progressDir: '/tmp/progress',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('string');
  });

  it('should build context for dep-conflict-resolver with dependency metadata', async () => {
    const ctx = await builder.build('dep-conflict-resolver', {
      issueNumber: 42,
      worktreePath: '/tmp/deps-worktree',
      conflictedFiles: ['src/a.ts', 'src/b.ts'],
      conflictingBranch: 'cadre/issue-1',
      depsBranch: 'cadre/deps-42',
      progressDir: '/tmp/progress',
    });

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
      await builder.build('issue-analyst', { issueNumber: 42, worktreePath: '/tmp/worktree', issueJsonPath: '/tmp/issue.json', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for codebase-scout', async () => {
      await builder.build('codebase-scout', { issueNumber: 42, worktreePath: '/tmp/worktree', analysisPath: '/tmp/analysis.md', fileTreePath: '/tmp/file-tree.txt', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for implementation-planner', async () => {
      await builder.build('implementation-planner', { issueNumber: 42, worktreePath: '/tmp/worktree', analysisPath: '/tmp/analysis.md', scoutReportPath: '/tmp/scout.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for adjudicator', async () => {
      await builder.build('adjudicator', { issueNumber: 42, worktreePath: '/tmp/worktree', planPaths: ['/tmp/plan1.md'], progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for code-reviewer', async () => {
      await builder.build('code-reviewer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, diffPath: '/tmp/diff.patch', sessionPlanPath: '/tmp/task-plan.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for integration-checker', async () => {
      await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should include outputSchema for pr-composer', async () => {
      await builder.build('pr-composer', { issueNumber: 42, worktreePath: '/tmp/worktree', issue: mockIssue, analysisPath: '/tmp/analysis.md', planPath: '/tmp/plan.md', integrationReportPath: '/tmp/integration.md', diffPath: '/tmp/diff.patch', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeDefined();
      expect(typeof ctx.outputSchema).toBe('object');
    });

    it('should NOT include outputSchema for code-writer', async () => {
      await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeUndefined();
    });
  });

  describe('build code-writer siblingFiles', () => {
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
      await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress', siblingFiles });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toEqual(siblingFiles);
    });

    it('should not include siblingFiles in payload when omitted', async () => {
      await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toBeUndefined();
    });

    it('should not include siblingFiles in payload when passed as empty array', async () => {
      await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress', siblingFiles: [] });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.siblingFiles).toBeUndefined();
    });

    it('should always include sessionId and steps in payload regardless of siblingFiles', async () => {
      await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress', siblingFiles: ['src/other.ts'] });
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
      await builder.build('test-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session: task, changedFiles: [], sessionPlanPath: '/tmp/task-plan.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputSchema).toBeUndefined();
    });

    it('should NOT include outputSchema for fix-surgeon', async () => {
      await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: task.id, feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 3 });
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

    describe('build code-writer', () => {
      it('includes analysis.md and scout-report.md in inputFiles when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md from inputFiles when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('code-writer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, sessionPlanPath: '/tmp/task-plan.md', relevantFiles: [], progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });
    });

    describe('build code-reviewer', () => {
      it('includes analysis.md and scout-report.md in inputFiles when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('code-reviewer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, diffPath: '/tmp/diff.patch', sessionPlanPath: '/tmp/task-plan.md', progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md from inputFiles when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('code-reviewer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, diffPath: '/tmp/diff.patch', sessionPlanPath: '/tmp/task-plan.md', progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });

      it('includes issueBody in payload when provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('code-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          session,
          diffPath: '/tmp/diff.patch',
          sessionPlanPath: '/tmp/task-plan.md',
          progressDir: '/tmp/progress',
          issueBody: 'Fix the login bug',
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.issueBody).toBe('Fix the login bug');
      });

      it('omits issueBody from payload when not provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('code-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          session,
          diffPath: '/tmp/diff.patch',
          sessionPlanPath: '/tmp/task-plan.md',
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.issueBody).toBeUndefined();
      });
    });

    describe('build fix-surgeon', () => {
      it('includes phase-3 session plan when phase===3 and file exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: 'session-001', feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 3 });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/session-session-001.md');
        expect(inputFiles).not.toContain('/tmp/progress/implementation-plan.md');
      });

      it('includes implementation-plan.md when phase===4 and file exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: 'session-001', feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 4 });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/implementation-plan.md');
        expect(inputFiles).not.toContain('/tmp/progress/session-session-001.md');
      });

      it('excludes plan file from inputFiles when it does not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: 'session-001', feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 3 });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/session-session-001.md');
      });

      it('includes analysis.md and scout-report.md when they exist', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: 'session-001', feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 3 });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
      });

      it('excludes analysis.md and scout-report.md when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('fix-surgeon', { issueNumber: 42, worktreePath: '/tmp/worktree', sessionId: 'session-001', feedbackPath: '/tmp/feedback.md', changedFiles: [], progressDir: '/tmp/progress', issueType: 'review', phase: 3 });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
      });
    });

    describe('build integration-checker', () => {
      it('includes baseline-results.json in inputFiles when it exists', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/worktree/.cadre/baseline-results.json');
      });

      it('excludes baseline-results.json from inputFiles when it does not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/worktree/.cadre/baseline-results.json');
      });
    });

    describe('build whole-pr-reviewer', () => {
      it('returns a string path', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        const result = await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        expect(typeof result).toBe('string');
      });

      it('does NOT include diffPath in inputFiles; sets fullDiffPath in payload', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: ['/tmp/progress/session-001.md', '/tmp/progress/session-002.md'],
          progressDir: '/tmp/progress',
        });
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
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).toContain('/tmp/progress/analysis.md');
        expect(inputFiles).toContain('/tmp/progress/scout-report.md');
        expect(inputFiles).toContain('/tmp/progress/implementation-plan.md');
      });

      it('excludes analysis.md, scout-report.md, and implementation-plan.md when they do not exist', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        const inputFiles = ctx.inputFiles as string[];
        expect(inputFiles).not.toContain('/tmp/progress/analysis.md');
        expect(inputFiles).not.toContain('/tmp/progress/scout-report.md');
        expect(inputFiles).not.toContain('/tmp/progress/implementation-plan.md');
      });

      it('includes outputSchema in context', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        expect(ctx.outputSchema).toBeDefined();
        expect(typeof ctx.outputSchema).toBe('object');
      });

      it('sets payload.scope to "whole-pr", payload.baseBranch to config.baseBranch, and includes sessionSummaries', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        const sessionSummaries = [
          { sessionId: 'session-001', verdict: 'pass' as const, summary: 'All good', keyFindings: [] },
        ];
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
          sessionSummaries,
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.scope).toBe('whole-pr');
        expect(payload.baseBranch).toBe('main');
        expect(payload.sessionSummaries).toEqual(sessionSummaries);
      });

      it('defaults sessionSummaries to empty array when not provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(Array.isArray(payload.sessionSummaries)).toBe(true);
        expect((payload.sessionSummaries as unknown[]).length).toBe(0);
      });

      it('sets agent to "whole-pr-reviewer" and phase to 3', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        expect(ctx.agent).toBe('whole-pr-reviewer');
        expect(ctx.phase).toBe(3);
      });

      it('includes issueBody in payload when provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
          sessionSummaries: [],
          issueBody: 'Add granular git commit workflow for migrated output',
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.issueBody).toBe('Add granular git commit workflow for migrated output');
      });

      it('omits issueBody from payload when not provided', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        await builder.build('whole-pr-reviewer', {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          diffPath: '/tmp/whole-pr-diff.patch',
          sessionPlanPaths: [],
          progressDir: '/tmp/progress',
        });
        const ctx = captureWrittenContext();
        const payload = ctx.payload as Record<string, unknown>;
        expect(payload.issueBody).toBeUndefined();
      });
    });
  });

  describe('AGENT_CONTEXT_REGISTRY', () => {
    const EXPECTED_AGENTS: AgentName[] = [
      'issue-analyst',
      'codebase-scout',
      'dependency-analyst',
      'implementation-planner',
      'adjudicator',
      'code-writer',
      'test-writer',
      'code-reviewer',
      'whole-pr-reviewer',
      'fix-surgeon',
      'integration-checker',
      'pr-composer',
      'conflict-resolver',
      'dep-conflict-resolver',
    ];

    it('should contain descriptors for all 14 agents', () => {
      for (const agent of EXPECTED_AGENTS) {
        expect(AGENT_CONTEXT_REGISTRY[agent]).toBeDefined();
      }
      expect(Object.keys(AGENT_CONTEXT_REGISTRY)).toHaveLength(EXPECTED_AGENTS.length);
    });

    it('should have required fields on every descriptor', () => {
      for (const [name, desc] of Object.entries(AGENT_CONTEXT_REGISTRY)) {
        expect(typeof desc.phase === 'number' || typeof desc.phase === 'function').toBe(true);
        expect(typeof desc.outputFile).toBe('function');
        expect(typeof desc.inputFiles).toBe('function');
      }
    });
  });

  describe('build() error handling', () => {
    it('should throw for an unknown agent name', async () => {
      await expect(
        builder.build('nonexistent-agent' as AgentName, {
          issueNumber: 42,
          worktreePath: '/tmp/worktree',
          progressDir: '/tmp/progress',
        }),
      ).rejects.toThrow('No context descriptor registered for agent: nonexistent-agent');
    });
  });

  describe('build() common fields', () => {
    it('should set agent, issueNumber, projectName, repository, worktreePath, and config.commands', async () => {
      await builder.build('issue-analyst', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        issueJsonPath: '/tmp/issue.json',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.agent).toBe('issue-analyst');
      expect(ctx.issueNumber).toBe(42);
      expect(ctx.projectName).toBe('test-project');
      expect(ctx.repository).toBe('owner/repo');
      expect(ctx.worktreePath).toBe('/tmp/worktree');
      expect(ctx.config).toEqual({ commands: mockConfig.commands });
    });

    it('should set the correct phase from a static descriptor', async () => {
      await builder.build('implementation-planner', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        analysisPath: '/tmp/analysis.md',
        scoutReportPath: '/tmp/scout-report.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.phase).toBe(2);
    });

    it('should set the correct phase from a dynamic descriptor (fix-surgeon)', async () => {
      await builder.build('fix-surgeon', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        sessionId: 'session-001',
        feedbackPath: '/tmp/feedback.md',
        changedFiles: [],
        progressDir: '/tmp/progress',
        issueType: 'review',
        phase: 4,
      });
      const ctx = captureWrittenContext();
      expect(ctx.phase).toBe(4);
    });

    it('should default fix-surgeon phase to 3 when not provided', async () => {
      await builder.build('fix-surgeon', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        sessionId: 'session-001',
        feedbackPath: '/tmp/feedback.md',
        changedFiles: [],
        progressDir: '/tmp/progress',
        issueType: 'review',
      });
      const ctx = captureWrittenContext();
      expect(ctx.phase).toBe(3);
    });
  });

  describe('build() sessionId', () => {
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

    it('should include sessionId for code-writer from session.id', async () => {
      await builder.build('code-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        sessionPlanPath: '/tmp/task-plan.md',
        relevantFiles: [],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.sessionId).toBe('session-001');
    });

    it('should include sessionId for test-writer from session.id', async () => {
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.sessionId).toBe('session-001');
    });

    it('should include sessionId for code-reviewer from session.id', async () => {
      await builder.build('code-reviewer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        diffPath: '/tmp/diff.patch',
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.sessionId).toBe('session-001');
    });

    it('should include sessionId for fix-surgeon from args.sessionId', async () => {
      await builder.build('fix-surgeon', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        sessionId: 'session-002',
        feedbackPath: '/tmp/feedback.md',
        changedFiles: [],
        progressDir: '/tmp/progress',
        issueType: 'review',
        phase: 3,
      });
      const ctx = captureWrittenContext();
      expect(ctx.sessionId).toBe('session-002');
    });

    it('should not include sessionId for agents without session support', async () => {
      await builder.build('issue-analyst', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        issueJsonPath: '/tmp/issue.json',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.sessionId).toBeUndefined();
    });
  });

  describe('build adjudicator', () => {
    it('should use planPaths as inputFiles', async () => {
      await builder.build('adjudicator', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        planPaths: ['/tmp/plan1.md', '/tmp/plan2.md'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.inputFiles).toEqual(['/tmp/plan1.md', '/tmp/plan2.md']);
    });

    it('should set payload.decisionType to implementation-strategy', async () => {
      await builder.build('adjudicator', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        planPaths: ['/tmp/plan1.md'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.decisionType).toBe('implementation-strategy');
    });

    it('should set outputPath to adjudication.md', async () => {
      await builder.build('adjudicator', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        planPaths: ['/tmp/plan1.md'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/progress/adjudication.md');
    });
  });

  describe('build test-writer', () => {
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

    it('should include changedFiles and sessionPlanPath in inputFiles', async () => {
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: ['src/auth/login.ts', 'src/auth/utils.ts'],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.inputFiles).toEqual(['src/auth/login.ts', 'src/auth/utils.ts', '/tmp/task-plan.md']);
    });

    it('should set payload with sessionId and testFramework', async () => {
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.sessionId).toBe('session-001');
      expect(payload.testFramework).toBeDefined();
    });

    it('should set outputPath to .cadre/tasks', async () => {
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/worktree/.cadre/tasks');
    });
  });

  describe('build conflict-resolver', () => {
    it('should map conflictedFiles to absolute paths in inputFiles', async () => {
      await builder.build('conflict-resolver', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        conflictedFiles: ['src/a.ts', 'src/b.ts'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.inputFiles).toEqual(['/tmp/worktree/src/a.ts', '/tmp/worktree/src/b.ts']);
    });

    it('should set payload with conflictedFiles and baseBranch', async () => {
      await builder.build('conflict-resolver', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        conflictedFiles: ['src/a.ts'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.conflictedFiles).toEqual(['src/a.ts']);
      expect(payload.baseBranch).toBe('main');
    });

    it('should set outputPath to conflict-resolution-report.md', async () => {
      await builder.build('conflict-resolver', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        conflictedFiles: [],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/progress/conflict-resolution-report.md');
    });

    it('should set phase to 0', async () => {
      await builder.build('conflict-resolver', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        conflictedFiles: [],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.phase).toBe(0);
    });
  });

  describe('build fix-surgeon payload', () => {
    it('should include sessionId and issueType in payload', async () => {
      await builder.build('fix-surgeon', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        sessionId: 'session-001',
        feedbackPath: '/tmp/feedback.md',
        changedFiles: ['src/a.ts'],
        progressDir: '/tmp/progress',
        issueType: 'test-failure',
        phase: 3,
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.sessionId).toBe('session-001');
      expect(payload.issueType).toBe('test-failure');
    });

    it('should include feedbackPath and changedFiles in inputFiles', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      await builder.build('fix-surgeon', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        sessionId: 'session-001',
        feedbackPath: '/tmp/feedback.md',
        changedFiles: ['src/a.ts', 'src/b.ts'],
        progressDir: '/tmp/progress',
        issueType: 'build',
        phase: 3,
      });
      const ctx = captureWrittenContext();
      const inputFiles = ctx.inputFiles as string[];
      expect(inputFiles[0]).toBe('/tmp/feedback.md');
      expect(inputFiles).toContain('src/a.ts');
      expect(inputFiles).toContain('src/b.ts');
    });
  });

  describe('detectTestFramework via test-writer payload', () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'Fix login',
      rationale: 'Fix the login handler',
      dependencies: [],
      steps: [{
        id: 'session-001-step-001',
        name: 'Step',
        description: 'Step',
        files: [],
        complexity: 'simple' as const,
        acceptanceCriteria: [],
      }],
    };

    it('should detect vitest', async () => {
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      // Default mockConfig uses 'npm test' which doesn't match vitest
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.testFramework).toBe('unknown');
    });

    it('should detect vitest when command includes vitest', async () => {
      mockConfig.commands.test = 'npx vitest run';
      builder = new ContextBuilder(mockConfig, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger);
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.testFramework).toBe('vitest');
    });

    it('should detect jest when command includes jest', async () => {
      mockConfig.commands.test = 'npx jest';
      builder = new ContextBuilder(mockConfig, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger);
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.testFramework).toBe('jest');
    });

    it('should detect mocha when command includes mocha', async () => {
      mockConfig.commands.test = 'npx mocha';
      builder = new ContextBuilder(mockConfig, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger);
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.testFramework).toBe('mocha');
    });

    it('should detect pytest when command includes pytest', async () => {
      mockConfig.commands.test = 'python -m pytest';
      builder = new ContextBuilder(mockConfig, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger);
      await builder.build('test-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        changedFiles: [],
        sessionPlanPath: '/tmp/task-plan.md',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.testFramework).toBe('pytest');
    });
  });

  describe('build pr-composer', () => {
    it('should include previousParseError in payload when provided', async () => {
      await builder.build('pr-composer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        issue: mockIssue,
        analysisPath: '/tmp/analysis.md',
        planPath: '/tmp/plan.md',
        integrationReportPath: '/tmp/integration.md',
        diffPath: '/tmp/diff.patch',
        progressDir: '/tmp/progress',
        previousParseError: 'JSON parse failed at line 5',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.previousParseError).toBe('JSON parse failed at line 5');
    });

    it('should not include previousParseError in payload when not provided', async () => {
      await builder.build('pr-composer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        issue: mockIssue,
        analysisPath: '/tmp/analysis.md',
        planPath: '/tmp/plan.md',
        integrationReportPath: '/tmp/integration.md',
        diffPath: '/tmp/diff.patch',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.previousParseError).toBeUndefined();
    });

    it('should include issueTitle and issueBody in payload', async () => {
      await builder.build('pr-composer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        issue: mockIssue,
        analysisPath: '/tmp/analysis.md',
        planPath: '/tmp/plan.md',
        integrationReportPath: '/tmp/integration.md',
        diffPath: '/tmp/diff.patch',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.issueTitle).toBe('Fix login');
      expect(payload.issueBody).toBe('Fix the login handler');
    });
  });

  describe('build integration-checker payload', () => {
    it('should include commands in payload from config', async () => {
      await builder.build('integration-checker', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      const commands = payload.commands as Record<string, unknown>;
      expect(commands.build).toBe('npm run build');
      expect(commands.test).toBe('npm test');
    });
  });

  describe('build dep-conflict-resolver payload', () => {
    it('should include all dependency metadata in payload', async () => {
      await builder.build('dep-conflict-resolver', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        conflictedFiles: ['src/x.ts'],
        conflictingBranch: 'cadre/issue-99',
        depsBranch: 'cadre/deps-42',
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.conflictedFiles).toEqual(['src/x.ts']);
      expect(payload.conflictingBranch).toBe('cadre/issue-99');
      expect(payload.depsBranch).toBe('cadre/deps-42');
      expect(payload.baseBranch).toBe('main');
    });
  });

  describe('payload omission for agents without payload descriptor', () => {
    it('should not include payload for issue-analyst', async () => {
      await builder.build('issue-analyst', { issueNumber: 42, worktreePath: '/tmp/worktree', issueJsonPath: '/tmp/issue.json', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.payload).toBeUndefined();
    });

    it('should not include payload for codebase-scout', async () => {
      await builder.build('codebase-scout', { issueNumber: 42, worktreePath: '/tmp/worktree', analysisPath: '/tmp/analysis.md', fileTreePath: '/tmp/tree.txt', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.payload).toBeUndefined();
    });

    it('should not include payload for implementation-planner', async () => {
      await builder.build('implementation-planner', { issueNumber: 42, worktreePath: '/tmp/worktree', analysisPath: '/tmp/analysis.md', scoutReportPath: '/tmp/scout.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.payload).toBeUndefined();
    });
  });

  describe('build code-reviewer payload and output', () => {
    it('should flatten acceptanceCriteria from multiple steps', async () => {
      const session: AgentSession = {
        id: 'session-001',
        name: 'Multi-step',
        rationale: 'Multiple steps',
        dependencies: [],
        steps: [
          { id: 's1', name: 'Step 1', description: 'First', files: [], complexity: 'simple' as const, acceptanceCriteria: ['AC-1', 'AC-2'] },
          { id: 's2', name: 'Step 2', description: 'Second', files: [], complexity: 'simple' as const, acceptanceCriteria: ['AC-3'] },
        ],
      };
      await builder.build('code-reviewer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, diffPath: '/tmp/diff.patch', sessionPlanPath: '/tmp/plan.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      const payload = ctx.payload as Record<string, unknown>;
      expect(payload.acceptanceCriteria).toEqual(['AC-1', 'AC-2', 'AC-3']);
    });

    it('should set outputPath to review-{sessionId}.md', async () => {
      const session: AgentSession = {
        id: 'session-007',
        name: 'Review',
        rationale: 'Review',
        dependencies: [],
        steps: [{ id: 's1', name: 'S', description: 'S', files: [], complexity: 'simple' as const, acceptanceCriteria: [] }],
      };
      await builder.build('code-reviewer', { issueNumber: 42, worktreePath: '/tmp/worktree', session, diffPath: '/tmp/diff.patch', sessionPlanPath: '/tmp/plan.md', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/progress/review-session-007.md');
    });
  });

  describe('build code-writer inputFiles and outputPath', () => {
    const session: AgentSession = {
      id: 'session-001',
      name: 'Writer',
      rationale: 'Writer',
      dependencies: [],
      steps: [{ id: 's1', name: 'S', description: 'S', files: [], complexity: 'simple' as const, acceptanceCriteria: [] }],
    };

    it('should include relevantFiles in inputFiles', async () => {
      await builder.build('code-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        sessionPlanPath: '/tmp/plan.md',
        relevantFiles: ['/tmp/worktree/src/a.ts', '/tmp/worktree/src/b.ts'],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      const inputFiles = ctx.inputFiles as string[];
      expect(inputFiles).toContain('/tmp/worktree/src/a.ts');
      expect(inputFiles).toContain('/tmp/worktree/src/b.ts');
      expect(inputFiles).toContain('/tmp/plan.md');
    });

    it('should set outputPath to worktreePath/.cadre/tasks', async () => {
      await builder.build('code-writer', {
        issueNumber: 42,
        worktreePath: '/tmp/worktree',
        session,
        sessionPlanPath: '/tmp/plan.md',
        relevantFiles: [],
        progressDir: '/tmp/progress',
      });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/worktree/.cadre/tasks');
    });
  });

  describe('build integration-checker output and phase', () => {
    it('should set outputPath to integration-report.md', async () => {
      await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.outputPath).toBe('/tmp/progress/integration-report.md');
    });

    it('should set phase to 4', async () => {
      await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      expect(ctx.phase).toBe(4);
    });

    it('should include worktreePath in inputFiles', async () => {
      await builder.build('integration-checker', { issueNumber: 42, worktreePath: '/tmp/worktree', progressDir: '/tmp/progress' });
      const ctx = captureWrittenContext();
      const inputFiles = ctx.inputFiles as string[];
      expect(inputFiles).toContain('/tmp/worktree');
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
