import type { RuntimeConfig } from '../../config/loader.js';
import { FleetCheckpointManager } from '@cadre-dev/framework/engine';
import type { Logger } from '@cadre-dev/framework/core';

export class ResetService {
  private readonly cadreDir: string;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.cadreDir = config.stateDir;
  }

  async reset(issueNumber?: number, fromPhase?: number): Promise<void> {
    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );

    const state = await checkpointManager.load();

    if (issueNumber) {
      this.logger.info(`Resetting issue #${issueNumber}`, {
        workItemId: String(issueNumber),
        data: { fromPhase },
      });
      await checkpointManager.setWorkItemStatus(String(issueNumber), 'not-started', '', '', 0, state.issues[String(issueNumber)]?.issueTitle ?? '');
      console.log(`Reset issue #${issueNumber}`);
    } else {
      this.logger.info('Resetting entire fleet');
      // Clear all issue statuses
      for (const num of Object.keys(state.issues)) {
        await checkpointManager.setWorkItemStatus(num, 'not-started', '', '', 0, state.issues[num]?.issueTitle ?? '');
      }
      console.log('Reset all issues');
    }
  }
}
