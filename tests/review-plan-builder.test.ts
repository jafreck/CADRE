import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewPlanBuilder } from '../src/core/review-plan-builder.js';
import type { ReviewThread, PRComment, PRReview } from '../src/platform/provider.js';

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'thread-1',
    prNumber: 10,
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        id: 'rc-1',
        author: 'reviewer',
        body: 'Please fix this function',
        createdAt: new Date().toISOString(),
        path: 'src/foo.ts',
        line: 42,
      },
    ],
    ...overrides,
  };
}

function makePRComment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: 'comment-1',
    author: 'reviewer',
    isBot: false,
    body: 'General feedback',
    createdAt: new Date().toISOString(),
    url: 'https://github.com/owner/repo/pull/10#comment-1',
    ...overrides,
  };
}

function makePRReview(overrides: Partial<PRReview> = {}): PRReview {
  return {
    id: 'review-1',
    author: 'reviewer',
    isBot: false,
    body: 'Review body feedback',
    state: 'CHANGES_REQUESTED',
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReviewPlanBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildPlanContent', () => {
    it('should return a plan with header and cadre-json block', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const content = builder.buildPlanContent([], [], []);

      expect(content).toContain('# Review-Response Implementation Plan');
      expect(content).toContain('```cadre-json');
      expect(content).toContain('```');
    });

    it('should generate tasks from active review threads', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const thread = makeThread();
      const content = builder.buildPlanContent([thread], [], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('session-001');
      expect(parsed[0].name).toContain('src/foo.ts');
      expect(parsed[0].steps).toHaveLength(1);
      expect(parsed[0].steps[0].id).toBe('session-001-step-001');
      expect(parsed[0].steps[0].files).toEqual(['src/foo.ts']);
    });

    it('should generate tasks from PR comments with correct session IDs', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const comment = makePRComment({ author: 'alice' });
      const content = builder.buildPlanContent([], [comment], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('session-001');
      expect(parsed[0].name).toBe('Address PR comment from alice');
      expect(parsed[0].steps[0].description).toBe('General feedback');
    });

    it('should generate tasks from PR reviews with correct session IDs', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const review = makePRReview({ author: 'bob' });
      const content = builder.buildPlanContent([], [], [review]);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('session-001');
      expect(parsed[0].name).toBe('Address PR review from bob');
    });

    it('should assign sequential session IDs across threads, comments, and reviews', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const thread = makeThread();
      const comment = makePRComment();
      const review = makePRReview();
      const content = builder.buildPlanContent([thread], [comment], [review]);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed).toHaveLength(3);
      expect(parsed[0].id).toBe('session-001'); // thread
      expect(parsed[1].id).toBe('session-002'); // comment
      expect(parsed[2].id).toBe('session-003'); // review
    });

    it('should deduplicate file paths in thread tasks', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const thread = makeThread({
        comments: [
          { id: 'rc-1', author: 'a', body: 'fix1', createdAt: '', path: 'src/foo.ts', line: 10 },
          { id: 'rc-2', author: 'a', body: 'fix2', createdAt: '', path: 'src/foo.ts', line: 20 },
        ],
      });
      const content = builder.buildPlanContent([thread], [], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed[0].steps[0].files).toEqual(['src/foo.ts']);
    });

    it('should join multiple comment bodies with double newline for thread descriptions', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const thread = makeThread({
        comments: [
          { id: 'rc-1', author: 'a', body: 'first', createdAt: '', path: 'src/a.ts' },
          { id: 'rc-2', author: 'b', body: 'second', createdAt: '', path: 'src/a.ts' },
        ],
      });
      const content = builder.buildPlanContent([thread], [], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed[0].steps[0].description).toBe('first\n\nsecond');
    });

    it('should handle thread with no file paths', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const thread = makeThread({
        comments: [
          { id: 'rc-1', author: 'a', body: 'general comment', createdAt: '', path: '' },
        ],
      });
      const content = builder.buildPlanContent([thread], [], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed[0].steps[0].files).toEqual([]);
      expect(parsed[0].name).toBe('Address review comment');
    });

    it('should return empty tasks array when no inputs are provided', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const content = builder.buildPlanContent([], [], []);
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      expect(parsed).toEqual([]);
    });

    it('should include acceptance criteria for each task type', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const content = builder.buildPlanContent(
        [makeThread()],
        [makePRComment()],
        [makePRReview()],
      );
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      // Thread task
      expect(parsed[0].steps[0].acceptanceCriteria).toContain('Review comment addressed as described');
      // Comment task
      expect(parsed[1].steps[0].acceptanceCriteria).toContain('PR comment addressed as described');
      // Review task
      expect(parsed[2].steps[0].acceptanceCriteria).toContain('PR review feedback addressed as described');
    });

    it('should set complexity to simple for all tasks', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const content = builder.buildPlanContent(
        [makeThread()],
        [makePRComment()],
        [makePRReview()],
      );
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      for (const task of parsed) {
        expect(task.steps[0].complexity).toBe('simple');
      }
    });

    it('should set empty dependencies for all tasks', () => {
      const builder = new ReviewPlanBuilder(makeLogger() as any);
      const content = builder.buildPlanContent(
        [makeThread()],
        [makePRComment()],
        [makePRReview()],
      );
      const parsed = JSON.parse(content.split('```cadre-json\n')[1].split('\n```')[0]);

      for (const task of parsed) {
        expect(task.dependencies).toEqual([]);
      }
    });
  });

  describe('writePlan', () => {
    it('should write implementation-plan.md to the progressDir', async () => {
      const { writeFile } = await import('node:fs/promises');
      const builder = new ReviewPlanBuilder(makeLogger() as any);

      await builder.writePlan('/tmp/progress', [makeThread()], [], []);

      expect(writeFile).toHaveBeenCalledWith(
        '/tmp/progress/implementation-plan.md',
        expect.stringContaining('# Review-Response Implementation Plan'),
        'utf-8',
      );
    });

    it('should write plan with content from all input types', async () => {
      const { writeFile } = await import('node:fs/promises');
      const builder = new ReviewPlanBuilder(makeLogger() as any);

      await builder.writePlan(
        '/tmp/progress',
        [makeThread()],
        [makePRComment()],
        [makePRReview()],
      );

      const writtenContent = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('session-001');
      expect(writtenContent).toContain('session-002');
      expect(writtenContent).toContain('session-003');
    });
  });
});
