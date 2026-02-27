import type { RuntimeConfig } from '../config/loader.js';
import { FleetCheckpointManager } from './checkpoint.js';
import type { Logger } from '../logging/logger.js';

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
        issueNumber,
        data: { fromPhase },
      });
      await checkpointManager.setIssueStatus(issueNumber, 'not-started', '', '', 0, state.issues[issueNumber]?.issueTitle ?? '');
      console.log(`Reset issue #${issueNumber}`);
    } else {
      this.logger.info('Resetting entire fleet');
      // Clear all issue statuses
      for (const num of Object.keys(state.issues)) {
        await checkpointManager.setIssueStatus(Number(num), 'not-started', '', '', 0, state.issues[Number(num)]?.issueTitle ?? '');
      }
      console.log('Reset all issues');
    }
  }
}
