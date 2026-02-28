import { Logger } from '../logging/logger.js';
import type { IssueDetail } from '../platform/provider.js';
import { WorktreeProvisioner } from './worktree-provisioner.js';

export { RemoteBranchMissingError, type WorktreeInfo } from './worktree-provisioner.js';

/**
 * Manages the lifecycle of git worktrees — one per issue.
 * Thin facade delegating all logic to WorktreeProvisioner.
 */
export class WorktreeManager {
  private readonly provisioner: WorktreeProvisioner;

  constructor(
    repoPath: string,
    worktreeRoot: string,
    baseBranch: string,
    branchTemplate: string,
    logger: Logger,
    agentDir?: string,
    backend: string = 'copilot',
    stateDir?: string,
  ) {
    this.provisioner = new WorktreeProvisioner(
      repoPath,
      worktreeRoot,
      baseBranch,
      branchTemplate,
      logger,
      agentDir,
      backend,
      stateDir,
    );
  }

  async provision(...args: Parameters<WorktreeProvisioner['provision']>) {
    return this.provisioner.provision(...args);
  }

  async provisionWithDeps(...args: Parameters<WorktreeProvisioner['provisionWithDeps']>) {
    return this.provisioner.provisionWithDeps(...args);
  }

  async provisionFromBranch(...args: Parameters<WorktreeProvisioner['provisionFromBranch']>) {
    return this.provisioner.provisionFromBranch(...args);
  }

  async provisionForDependencyAnalyst(...args: Parameters<WorktreeProvisioner['provisionForDependencyAnalyst']>) {
    return this.provisioner.provisionForDependencyAnalyst(...args);
  }

  async prefetch() {
    return this.provisioner.prefetch();
  }

  async remove(...args: Parameters<WorktreeProvisioner['remove']>) {
    return this.provisioner.remove(...args);
  }

  async removeWorktreeAtPath(...args: Parameters<WorktreeProvisioner['removeWorktreeAtPath']>) {
    return this.provisioner.removeWorktreeAtPath(...args);
  }

  async listActive() {
    return this.provisioner.listActive();
  }

  async exists(...args: Parameters<WorktreeProvisioner['exists']>) {
    return this.provisioner.exists(...args);
  }

  async rebase(...args: Parameters<WorktreeProvisioner['rebase']>) {
    return this.provisioner.rebase(...args);
  }

  async rebaseStart(...args: Parameters<WorktreeProvisioner['rebaseStart']>) {
    return this.provisioner.rebaseStart(...args);
  }

  async rebaseContinue(...args: Parameters<WorktreeProvisioner['rebaseContinue']>) {
    return this.provisioner.rebaseContinue(...args);
  }

  async rebaseAbort(...args: Parameters<WorktreeProvisioner['rebaseAbort']>) {
    return this.provisioner.rebaseAbort(...args);
  }

  resolveBranchName(...args: Parameters<WorktreeProvisioner['resolveBranchName']>) {
    return this.provisioner.resolveBranchName(...args);
  }

  public getWorktreePath(...args: Parameters<WorktreeProvisioner['getWorktreePath']>) {
    return this.provisioner.getWorktreePath(...args);
  }
}