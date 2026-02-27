import { join } from 'node:path';
import { WorktreeManager } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { Logger } from '../logging/logger.js';

/**
 * Handles rebasing a worktree branch and resolving any merge conflicts
 * via the conflict-resolver agent.
 */
export class RebaseRecoveryService {
  constructor(
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly contextBuilder: ContextBuilder,
    private readonly logger: Logger,
  ) {}

  /**
   * Rebase the worktree onto the latest base branch. If conflicts arise,
   * launch the conflict-resolver agent to resolve them, then continue the
   * rebase. On any failure, the rebase is aborted and an error is thrown.
   */
  async rebaseAndResolveConflicts(
    issueNumber: number,
    prNumber: number,
    worktreePath: string,
    progressDir: string,
  ): Promise<void> {
    const rebaseStartResult = await this.worktreeManager.rebaseStart(issueNumber);

    if (rebaseStartResult.status === 'conflict') {
      if (rebaseStartResult.conflictedFiles.length === 0) {
        this.logger.info(
          `Rebase paused for PR #${prNumber} with 0 conflicted files — continuing rebase without conflict-resolver`,
          { issueNumber },
        );
      } else {
        this.logger.info(
          `Merge conflicts detected for PR #${prNumber}; launching conflict-resolver agent`,
          { issueNumber, data: { conflictedFiles: rebaseStartResult.conflictedFiles } },
        );

        const conflictContextPath = await this.contextBuilder.build('conflict-resolver', {
          issueNumber,
          worktreePath,
          conflictedFiles: rebaseStartResult.conflictedFiles,
          progressDir,
        });

        const resolverResult = await this.launcher.launchAgent(
          {
            agent: 'conflict-resolver',
            issueNumber,
            phase: 0,
            contextPath: conflictContextPath,
            outputPath: join(progressDir, 'conflict-resolution-report.md'),
          },
          worktreePath,
        );

        if (!resolverResult.success) {
          const detail = resolverResult.timedOut
            ? `timed out after ${resolverResult.duration}ms`
            : `exit ${resolverResult.exitCode}`;
          this.logger.error(
            `Conflict-resolver agent failed for PR #${prNumber} (${detail})`,
            {
              issueNumber,
              data: {
                timedOut: resolverResult.timedOut,
                exitCode: resolverResult.exitCode,
                stderr: resolverResult.stderr?.slice(-500) ?? '',
              },
            },
          );
          await this.worktreeManager.rebaseAbort(issueNumber);
          throw new Error(`Conflict-resolver agent failed for PR #${prNumber} (${detail})`);
        }

        if (!resolverResult.outputExists) {
          this.logger.error(
            `Conflict-resolver agent for PR #${prNumber} exited successfully but produced no output at ${resolverResult.outputPath}`,
            {
              issueNumber,
              data: {
                outputPath: resolverResult.outputPath,
                stderr: resolverResult.stderr?.slice(-300) ?? '',
              },
            },
          );
          await this.worktreeManager.rebaseAbort(issueNumber);
          throw new Error(
            `Conflict-resolver agent produced no output for PR #${prNumber} — resolution report missing at ${resolverResult.outputPath}`,
          );
        }
      }

      const continueResult = await this.worktreeManager.rebaseContinue(issueNumber);
      if (!continueResult.success) {
        this.logger.error(
          `Rebase --continue failed for PR #${prNumber}: ${continueResult.error ?? 'unknown error'}`,
          { issueNumber, data: { conflictedFiles: continueResult.conflictedFiles } },
        );
        await this.worktreeManager.rebaseAbort(issueNumber);
        throw new Error(
          `Rebase --continue failed after conflict resolution for PR #${prNumber}: ${continueResult.error ?? 'unknown error'}`,
        );
      }
    }
  }
}
