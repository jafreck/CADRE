import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PRComment, PRReview, ReviewThread } from '../platform/provider.js';
import { Logger } from '../logging/logger.js';

/**
 * Builds a synthetic implementation plan from review threads, PR comments,
 * and PR reviews, then writes it as implementation-plan.md.
 */
export class ReviewPlanBuilder {
  constructor(
    private readonly logger: Logger,
  ) {}

  /**
   * Generate plan content from active review threads, actionable PR comments,
   * and actionable PR reviews.
   */
  buildPlanContent(
    activeThreads: ReviewThread[],
    actionableComments: PRComment[],
    actionableReviews: PRReview[],
  ): string {
    const threadTasks = activeThreads.map((thread, idx) => {
      const files = [...new Set(thread.comments.map((c) => c.path).filter(Boolean))];
      const description = thread.comments.map((c) => c.body).join('\n\n');
      const sessionId = `session-${String(idx + 1).padStart(3, '0')}`;
      return {
        id: sessionId,
        name: `Address review comment${files.length ? ` in ${files[0]}` : ''}`,
        rationale: 'Address code review thread',
        dependencies: [] as string[],
        steps: [{
          id: `${sessionId}-step-001`,
          name: `Address review comment${files.length ? ` in ${files[0]}` : ''}`,
          description,
          files: files.length ? files : [],
          complexity: 'simple' as const,
          acceptanceCriteria: [
            'Review comment addressed as described',
            'Existing tests continue to pass',
          ],
        }],
      };
    });

    const commentTasks = actionableComments.map((comment, idx) => {
      const sessionIdx = activeThreads.length + idx + 1;
      const sessionId = `session-${String(sessionIdx).padStart(3, '0')}`;
      return {
        id: sessionId,
        name: `Address PR comment from ${comment.author}`,
        rationale: 'Address PR comment',
        dependencies: [] as string[],
        steps: [{
          id: `${sessionId}-step-001`,
          name: `Address PR comment from ${comment.author}`,
          description: comment.body,
          files: [] as string[],
          complexity: 'simple' as const,
          acceptanceCriteria: [
            'PR comment addressed as described',
            'Existing tests continue to pass',
          ],
        }],
      };
    });

    const reviewBodyTasks = actionableReviews.map((review, idx) => {
      const sessionIdx = activeThreads.length + actionableComments.length + idx + 1;
      const sessionId = `session-${String(sessionIdx).padStart(3, '0')}`;
      return {
        id: sessionId,
        name: `Address PR review from ${review.author}`,
        rationale: 'Address PR review feedback',
        dependencies: [] as string[],
        steps: [{
          id: `${sessionId}-step-001`,
          name: `Address PR review from ${review.author}`,
          description: review.body,
          files: [] as string[],
          complexity: 'simple' as const,
          acceptanceCriteria: [
            'PR review feedback addressed as described',
            'Existing tests continue to pass',
          ],
        }],
      };
    });

    const planTasks = [...threadTasks, ...commentTasks, ...reviewBodyTasks];
    return [
      '# Review-Response Implementation Plan',
      '',
      '```cadre-json',
      JSON.stringify(planTasks, null, 2),
      '```',
    ].join('\n');
  }

  /**
   * Build the plan and write it to implementation-plan.md in the given progressDir.
   */
  async writePlan(
    progressDir: string,
    activeThreads: ReviewThread[],
    actionableComments: PRComment[],
    actionableReviews: PRReview[],
  ): Promise<void> {
    const planContent = this.buildPlanContent(activeThreads, actionableComments, actionableReviews);
    await writeFile(join(progressDir, 'implementation-plan.md'), planContent, 'utf-8');
  }
}
