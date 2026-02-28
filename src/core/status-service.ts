import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import { FleetCheckpointManager, CheckpointManager } from './checkpoint.js';
import { exists } from '../util/fs.js';
import { renderFleetStatus, renderIssueDetail } from '../cli/status-renderer.js';
import type { Logger } from '../logging/logger.js';

export class StatusService {
  private readonly cadreDir: string;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.cadreDir = config.stateDir;
  }

  async status(issueNumber?: number): Promise<void> {
    const fleetCheckpointPath = join(this.cadreDir, 'fleet-checkpoint.json');

    if (!(await exists(fleetCheckpointPath))) {
      console.log('No fleet checkpoint found.');
      return;
    }

    const checkpointManager = new FleetCheckpointManager(
      this.cadreDir,
      this.config.projectName,
      this.logger,
    );

    const state = await checkpointManager.load();

    if (issueNumber !== undefined) {
      const issueStatus = state.issues[issueNumber];
      if (!issueStatus) {
        console.log(`Issue #${issueNumber} not found in fleet checkpoint.`);
        return;
      }

      const issueProgressDir = join(this.cadreDir, 'issues', String(issueNumber));
      const issueCheckpointPath = join(issueProgressDir, 'checkpoint.json');

      if (!(await exists(issueCheckpointPath))) {
        console.log(`No per-issue checkpoint found for issue #${issueNumber}`);
        return;
      }

      const issueCpManager = new CheckpointManager(issueProgressDir, this.logger);
      try {
        const issueCheckpoint = await issueCpManager.load(String(issueNumber));
        console.log(renderIssueDetail(issueNumber, issueStatus, issueCheckpoint));
      } catch {
        console.log(`No per-issue checkpoint found for issue #${issueNumber}`);
      }
    } else {
      console.log(renderFleetStatus(state, this.config.agent.model, this.config.agent.copilot));
    }
  }
}
