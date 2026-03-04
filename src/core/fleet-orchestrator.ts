import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail, PullRequestInfo } from '../platform/provider.js';
import type { PlatformProvider } from '../platform/provider.js';
import { WorktreeManager, RemoteBranchMissingError, type WorktreeInfo } from '../git/worktree.js';
import { AgentLauncher } from './agent-launcher.js';
import { CheckpointManager, FleetCheckpointManager, FleetProgressWriter, WorkItemDag } from '@cadre/framework/engine';
import { IssueOrchestrator, type IssueResult } from './issue-orchestrator.js';
import { TokenTracker, type TokenSummary } from '@cadre/framework/runtime';
import { CostEstimator, FleetEventBus, Logger } from '@cadre/framework/core';
import { NotificationManager } from '@cadre/framework/notifications';
import { ReviewResponseOrchestrator } from './review-response-orchestrator.js';
import { DependencyMergeConflictError } from '../errors.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ensureDir, exists } from '../util/fs.js';
import type { DependencyMergeConflictContext } from '../git/dependency-branch-merger.js';
import { FleetReporter } from './fleet-reporter.js';
import { FleetScheduler } from './fleet-scheduler.js';
import { PullRequestCompletionQueue, type CompletionFailure, type MergeConflictResolverFn } from './pr-completion-queue.js';
import { MergeRetryHelper } from './merge-retry.js';
import type { PullRequestMergeMethod } from '../platform/provider.js';

export interface FleetResult {
  /** Whether all issues were resolved successfully. */
  success: boolean;
  /** Per-issue outcomes. */
  issues: IssueResult[];
  /** Issues that completed and had PRs opened. */
  prsCreated: PullRequestInfo[];
  /** Issues that failed or were blocked. */
  failedIssues: Array<{ issueNumber: number; error: string }>;
  /** Issues where code is complete but no PR was created. */
  codeDoneNoPR: Array<{ issueNumber: number; branch: string }>;
  /** Total duration across all pipelines. */
  totalDuration: number;
  /** Aggregate token usage. */
  tokenUsage: TokenSummary;
  /** Summary of resume open-PR completion subsystem execution. */
  prCompletion?: {
    queued: number;
    failed: number;
    failures: CompletionFailure[];
  };
}

/**
 * Manages all issue pipelines running in parallel.
 */
export class FleetOrchestrator {
  private readonly cadreDir: string;
  private readonly fleetCheckpoint: FleetCheckpointManager;
  private readonly fleetProgress: FleetProgressWriter;
  private readonly tokenTracker: TokenTracker;
  private readonly costEstimator: CostEstimator;
  private readonly contextBuilder: ContextBuilder;
  private fleetBudgetExceeded = false;
  private eventBus!: FleetEventBus;
  private reporter!: FleetReporter;
  private readonly prCompletionQueue: PullRequestCompletionQueue;
  private readonly autoCompleteEnabled: boolean;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly issues: IssueDetail[],
    private readonly worktreeManager: WorktreeManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager = new NotificationManager(),
    private readonly dag?: WorkItemDag<IssueDetail>,
    private readonly dagDepMap?: Record<number, number[]>,
  ) {
    this.cadreDir = config.stateDir;
    this.fleetCheckpoint = new FleetCheckpointManager(this.cadreDir, config.projectName, logger);
    this.fleetProgress = new FleetProgressWriter(this.cadreDir, logger);
    this.tokenTracker = new TokenTracker();
    this.costEstimator = new CostEstimator(config.agent.copilot);
    this.contextBuilder = new ContextBuilder(config, logger);

    const autoComplete = this.resolveAutoCompleteConfig();
    this.autoCompleteEnabled = autoComplete.enabled;
    this.prCompletionQueue = new PullRequestCompletionQueue(
      this.platform,
      this.logger,
      this.config.baseBranch,
      autoComplete.mergeMethod,
      autoComplete.enabled,  // Fix 2: Always enabled when auto-complete is on, not just on resume.
      (dependencyIssueNumber) => {
        const status = this.fleetCheckpoint.getIssueStatus(dependencyIssueNumber)?.status;
        return status === 'completed';
      },
      autoComplete.enabled ? this.buildCompletionQueueConflictResolver() : undefined,
    );
  }

  /**
   * Execute all issue pipelines with bounded parallelism.
   */
  async run(): Promise<FleetResult> {

    const startTime = Date.now();

    // Load fleet checkpoint
    await this.fleetCheckpoint.load();

    // On resume, reconcile stale checkpoint entries against actual PR state.
    // Issues whose PRs merged since the last run are promoted to 'completed'
    // so the scheduler doesn't re-process them or block their dependents.
    if (this.config.options.resume) {
      await this.reconcileCheckpoint();
    }

    const eventBus = new FleetEventBus(this.notifications, this.fleetProgress);
    const reporter = new FleetReporter(
      this.config, this.issues, this.fleetCheckpoint, this.fleetProgress, this.tokenTracker, this.logger,
    );
    const scheduler = new FleetScheduler(
      this.config, this.issues, this.fleetCheckpoint, this.platform, this.logger, this.dagDepMap,
    );
    this.eventBus = eventBus;
    this.reporter = reporter;

    this.logger.info(`Fleet starting: ${this.issues.length} issues, max ${this.config.options.maxParallelIssues} parallel`);
    await eventBus.appendFleetStarted(this.issues.length);
    await eventBus.dispatchFleetStarted(this.issues.length, this.config.options.maxParallelIssues);

    // Filter out already completed issues on resume
    const issuesToProcess = this.config.options.resume
      ? this.issues.filter((issue) => !this.fleetCheckpoint.isIssueCompleted(issue.number))
      : this.issues;

    if (issuesToProcess.length < this.issues.length) {
      const skipped = this.issues.length - issuesToProcess.length;
      this.logger.info(`Resume: skipping ${skipped} already-completed issues`);
    }

    // Pre-fetch remote refs once before any per-issue pipeline starts
    await this.worktreeManager.prefetch();

    // Build (or refresh) the shared agent-file cache so worktree provision
    // creates symlinks instead of copying files into every worktree.
    await this.worktreeManager.buildAgentCache();

    const results = await scheduler.schedule(
      issuesToProcess,
      (issue, dag) => this.processIssue(issue, dag),
      (issue) => this.markIssueDepBlocked(issue),
      this.dag,
    );

    await this.prCompletionQueue.drain();
    const completionFailures = this.prCompletionQueue.getFailures();
    const queuedCompletions = this.prCompletionQueue.getQueuedCount();
    if (this.prCompletionQueue.getQueuedCount() > 0) {
      this.logger.info(
        `PR completion subsystem finished: ${this.prCompletionQueue.getQueuedCount()} queued, ${completionFailures.length} failed`,
      );
    }

    // Promote issues whose PRs were successfully merged by the completion queue
    // from 'code-complete' to 'completed'.  Issues whose merges failed stay as
    // 'code-complete' so the next resume run can retry them.
    const mergedIssueNumbers = this.prCompletionQueue.getCompletedIssueNumbers();
    for (const issueNumber of mergedIssueNumbers) {
      const current = this.fleetCheckpoint.getIssueStatus(issueNumber);
      if (current && current.status === 'code-complete') {
        await this.fleetCheckpoint.setIssueStatus(
          issueNumber,
          'completed',
          current.worktreePath,
          current.branchName,
          current.lastPhase,
          current.issueTitle,
        );
        this.logger.info(
          `Promoted issue #${issueNumber} from code-complete to completed after PR merge`,
          { issueNumber },
        );
      }
    }

    // Aggregate results
    const fleetResult = reporter.aggregateResults(results, startTime);
    fleetResult.prCompletion = {
      queued: queuedCompletions,
      failed: completionFailures.length,
      failures: completionFailures,
    };

    // Write run report
    await reporter.writeReport(fleetResult, startTime);

    // Write final progress
    await reporter.writeFleetProgress(fleetResult);
    await eventBus.appendFleetCompleted(fleetResult.prsCreated.length, fleetResult.failedIssues.length);
    await eventBus.dispatchFleetCompleted(
      fleetResult.success,
      fleetResult.prsCreated.length,
      fleetResult.failedIssues.length,
      fleetResult.totalDuration,
      fleetResult.tokenUsage.total,
    );

    return fleetResult;
  }

  private resolveAutoCompleteConfig(): { enabled: boolean; mergeMethod: PullRequestMergeMethod } {
    const autoComplete = this.config.pullRequest.autoComplete;
    if (autoComplete == null) {
      return { enabled: false, mergeMethod: 'squash' };
    }

    if (typeof autoComplete === 'boolean') {
      return { enabled: autoComplete, mergeMethod: 'squash' };
    }

    return {
      enabled: autoComplete.enabled ?? false,
      mergeMethod: autoComplete.merge_method ?? 'squash',
    };
  }

  /**
   * Reconcile stale checkpoint statuses against the actual platform state.
   *
   * On resume, the checkpoint may contain failure statuses (dep-merge-conflict,
   * dep-blocked, failed, etc.) that are no longer accurate — for example, a PR
   * may have been merged manually, or a retry succeeded after the checkpoint was
   * written.
   *
   * Phase 1 — Promote merged PRs:  For each reconcilable issue with a branch,
   *   query the platform.  If a merged PR is found, promote to 'completed'.
   *
   * Phase 2 — Retry merge for dep-merge-conflict:  For dep-merge-conflict issues
   *   whose PRs are still open, attempt to merge again (upstream changes may have
   *   resolved the conflict).  Only promote on success.
   *
   * Phase 3 — Clear dep-blocked:  For dep-blocked issues, check whether all
   *   dependencies are now completed.  If so, delete the checkpoint entry so the
   *   issue is scheduled for fresh processing.
   */
  private async reconcileCheckpoint(): Promise<void> {
    const reconcilableStatuses = new Set([
      'dep-merge-conflict',
      'dep-failed',
      'dep-build-broken',
      'failed',
    ]);

    const allStatuses = this.fleetCheckpoint.getAllIssueStatuses();

    // Helper: resolve branchName from checkpoint or derive from issue metadata
    const issueMap = new Map(this.issues.map((i) => [i.number, i]));
    const resolveBranch = (issueNumber: number, stored: string): string => {
      if (stored) return stored;
      const issue = issueMap.get(issueNumber);
      return this.worktreeManager.resolveBranchName(issueNumber, issue?.title);
    };

    const toReconcile = allStatuses.filter(
      ([num, s]) => reconcilableStatuses.has(s.status) && resolveBranch(num, s.branchName),
    );

    // ── Phase 1: Promote issues whose PRs have been merged ──
    let promoted = 0;
    if (toReconcile.length > 0) {
      this.logger.info(
        `Resume reconciliation: checking ${toReconcile.length} failed issues against actual PR state`,
      );

      for (const [issueNumber, issueStatus] of toReconcile) {
        const branch = resolveBranch(issueNumber, issueStatus.branchName);
        try {
          const prs = await this.platform.listPullRequests({
            head: branch,
            state: 'all',
          });
          const merged = prs.find((pr) => pr.state === 'merged');
          if (merged) {
            this.logger.info(
              `Reconciliation: issue #${issueNumber} has merged PR #${merged.number} — promoting '${issueStatus.status}' → 'completed'`,
              { issueNumber },
            );
            await this.fleetCheckpoint.setIssueStatus(
              issueNumber,
              'completed',
              issueStatus.worktreePath,
              branch,
              issueStatus.lastPhase,
              issueStatus.issueTitle,
            );
            promoted++;
          }
        } catch (err) {
          this.logger.warn(
            `Reconciliation: could not check PR state for issue #${issueNumber}: ${err}`,
            { issueNumber },
          );
        }
      }
    }

    // ── Phase 2: Retry merge for dep-merge-conflict issues with open PRs ──
    const conflictIssues = allStatuses.filter(
      ([num, s]) => s.status === 'dep-merge-conflict' && resolveBranch(num, s.branchName),
    );
    let mergeRetried = 0;
    for (const [issueNumber, issueStatus] of conflictIssues) {
      // Skip if already promoted in Phase 1
      if (this.fleetCheckpoint.isIssueCompleted(issueNumber)) continue;
      const branch = resolveBranch(issueNumber, issueStatus.branchName);
      try {
        const prs = await this.platform.listPullRequests({
          head: branch,
          state: 'open',
        });
        const openPR = prs[0];
        if (!openPR) continue;

        this.logger.info(
          `Reconciliation: retrying merge for issue #${issueNumber} PR #${openPR.number}`,
          { issueNumber },
        );
        const helper = new MergeRetryHelper(this.platform, this.logger, this.config.baseBranch);
        const merged = await helper.mergeWithRetry({
          prNumber: openPR.number,
          prUrl: openPR.url,
          branch,
          issueNumber,
        });
        if (merged) {
          this.logger.info(
            `Reconciliation: merge succeeded for issue #${issueNumber} PR #${openPR.number} — promoting to 'completed'`,
            { issueNumber },
          );
          await this.fleetCheckpoint.setIssueStatus(
            issueNumber,
            'completed',
            issueStatus.worktreePath,
            branch,
            issueStatus.lastPhase,
            issueStatus.issueTitle,
          );
          promoted++;
          mergeRetried++;
        } else {
          this.logger.info(
            `Reconciliation: merge still failing for issue #${issueNumber} PR #${openPR.number}; will re-process`,
            { issueNumber },
          );
          // Backfill the resolved branchName into the checkpoint so future
          // reconciliation cycles don't need to re-derive it.
          if (!issueStatus.branchName && branch) {
            await this.fleetCheckpoint.setIssueStatus(
              issueNumber,
              issueStatus.status,
              issueStatus.worktreePath,
              branch,
              issueStatus.lastPhase,
              issueStatus.issueTitle,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Reconciliation: could not retry merge for issue #${issueNumber}: ${err}`,
          { issueNumber },
        );
      }
    }

    // ── Phase 3: Clear dep-blocked when dependencies are resolved ──
    const depBlockedIssues = allStatuses.filter(
      ([_, s]) => s.status === 'dep-blocked',
    );
    let cleared = 0;
    if (depBlockedIssues.length > 0 && this.dagDepMap) {
      for (const [issueNumber] of depBlockedIssues) {
        const deps = this.dagDepMap[issueNumber] ?? [];
        const allDepsCompleted = deps.every((dep) => this.fleetCheckpoint.isIssueCompleted(dep));
        if (allDepsCompleted) {
          this.logger.info(
            `Reconciliation: clearing dep-blocked for issue #${issueNumber} — all dependencies now completed`,
            { issueNumber },
          );
          await this.fleetCheckpoint.clearIssueStatus(issueNumber);
          cleared++;
        }
      }
    }

    if (promoted > 0 || cleared > 0) {
      this.logger.info(
        `Resume reconciliation complete: promoted ${promoted} issues to 'completed'${mergeRetried > 0 ? ` (${mergeRetried} via merge retry)` : ''}, cleared ${cleared} dep-blocked`,
      );
    }
  }

  /**
   * Build a conflict resolver callback for the PR completion queue.
   *
   * When a pre-existing PR cannot merge due to dirty state, this callback
   * resolves the conflict using the same approach as the PR composition phase:
   * fetch base, attempt merge, detect conflicted files, launch conflict-resolver
   * agent, commit, and push.
   */
  private buildCompletionQueueConflictResolver(): MergeConflictResolverFn {
    /** Cadre artifact path patterns used to detect cadre-only conflicts. */
    const cadreArtifactPatterns = ['.cadre/', 'task-', '.github/agents/', '.claude/agents/'];
    const isCadreArtifact = (f: string) => cadreArtifactPatterns.some((p) => f.includes(p));

    return async (item, errorDetails) => {
      let worktreePath = this.worktreeManager.getWorktreePath(item.issueNumber);
      const progressDir = join(this.cadreDir, 'issues', String(item.issueNumber));
      await ensureDir(progressDir);

      // For existing-PR issues, no worktree was provisioned during the run.
      // Provision one from the branch so we can perform local conflict resolution.
      if (!(await exists(worktreePath))) {
        this.logger.info(
          `Provisioning worktree for conflict resolution on PR #${item.prNumber} (issue #${item.issueNumber})`,
          { issueNumber: item.issueNumber },
        );
        const wtInfo = await this.worktreeManager.provisionFromBranch(item.issueNumber, item.branch);
        worktreePath = wtInfo.path;
      }

      const git = simpleGit(worktreePath);
      await git.fetch('origin', this.config.baseBranch);

      try {
        await git.merge([`origin/${this.config.baseBranch}`, '--no-edit']);
      } catch {
        const conflictedFiles = await this.getConflictedFiles(git);
        if (conflictedFiles.length === 0) {
          this.logger.warn(
            `PR #${item.prNumber} reported dirty merge state, but no conflicted files were detected`,
            { issueNumber: item.issueNumber },
          );
          return false;
        }

        // Fix 3: If all conflicts are cadre artifacts, auto-resolve without an agent.
        const realConflicts = conflictedFiles.filter((f) => !isCadreArtifact(f));
        if (realConflicts.length === 0) {
          this.logger.info(
            `All ${conflictedFiles.length} conflicted file(s) for PR #${item.prNumber} are cadre artifacts — auto-resolving`,
            { issueNumber: item.issueNumber },
          );
          for (const f of conflictedFiles) {
            await git.raw(['checkout', '--theirs', f]).catch(() => {});
          }
          await git.add(['-A']);
          await git.raw(['commit', '--no-edit']);
        } else {
          const conflictDetailsPath = join(progressDir, 'merge-conflict-details.txt');
          await writeFile(conflictDetailsPath, errorDetails, 'utf-8');

          const contextPath = await this.contextBuilder.build('conflict-resolver', {
            issueNumber: item.issueNumber,
            worktreePath,
            conflictedFiles,
            progressDir,
          });

          const resolverResult = await this.launcher.launchAgent(
            {
              agent: 'conflict-resolver',
              issueNumber: item.issueNumber,
              phase: 5,
              contextPath,
              outputPath: join(progressDir, 'merge-conflict-resolution-report.md'),
            },
            worktreePath,
          );

          if (!resolverResult.success) {
            this.logger.warn(
              `conflict-resolver failed for PR #${item.prNumber}`,
              { issueNumber: item.issueNumber },
            );
            return false;
          }

          // Fix 4: Check actual conflict state, not output file.
          const remaining = await this.getConflictedFiles(git);
          if (remaining.length > 0) {
            this.logger.warn(
              `conflict-resolver left ${remaining.length} unresolved file(s) for PR #${item.prNumber}`,
              { issueNumber: item.issueNumber },
            );
            return false;
          }

          await git.add(['-A']);
          await git.raw(['commit', '--no-edit']);
        }
      }

      // Push the resolved merge
      await git.push('origin', item.branch, ['--force-with-lease']);
      this.logger.info(
        `Resolved merge conflicts for PR #${item.prNumber} and pushed`,
        { issueNumber: item.issueNumber },
      );
      return true;
    };
  }

  private async getConflictedFiles(git: ReturnType<typeof simpleGit>): Promise<string[]> {
    try {
      const output = await git.raw(['diff', '--name-only', '--diff-filter=U']);
      return output
        .trim()
        .split('\n')
        .map((file) => file.trim())
        .filter((file) => file.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Execute review-response pipelines (phases 3–5) for issues with open PRs
   * that have unresolved review threads.
   */
  async runReviewResponse(issueNumbers?: number[]): Promise<FleetResult> {
    const startTime = Date.now();
    const orchestrator = new ReviewResponseOrchestrator(
      this.config,
      this.worktreeManager,
      this.launcher,
      this.platform,
      this.logger,
      this.notifications,
    );

    const rrResult = await orchestrator.run(issueNumbers);

    const issueResults: IssueResult[] = rrResult.issues
      .filter((o) => !o.skipped && o.result != null)
      .map((o) => o.result!);

    const prsCreated = issueResults.filter((r) => r.pr != null).map((r) => r.pr!);

    const failedIssues = rrResult.issues
      .filter((o) => !o.skipped && (o.result == null || !o.result.success))
      .map((o) => ({
        issueNumber: o.issueNumber,
        error: o.result?.error ?? 'Review response pipeline failed',
      }));

    return {
      success: failedIssues.length === 0,
      issues: issueResults,
      prsCreated,
      failedIssues,
      codeDoneNoPR: [],
      totalDuration: Date.now() - startTime,
      tokenUsage: this.tokenTracker.getSummary(),
      prCompletion: {
        queued: 0,
        failed: 0,
        failures: [],
      },
    };
  }

  /**
   * Process a single issue through its full pipeline.
   */
  private async processIssue(issue: IssueDetail, dag?: WorkItemDag<IssueDetail>): Promise<IssueResult> {
    // Abort early if fleet budget was already exceeded by a completed issue
    if (this.fleetBudgetExceeded) {
      this.logger.warn(`Skipping issue #${issue.number}: fleet budget exceeded`, {
        issueNumber: issue.number,
      });
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'budget-exceeded',
        '',
        '',
        0,
        issue.title,
        'Fleet budget exceeded',
      );
      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
        budgetExceeded: true,
        phases: [],
        totalDuration: 0,
        tokenUsage: 0,
        error: 'Fleet budget exceeded',
      };
    }

    this.logger.info(`Processing issue #${issue.number}: ${issue.title}`, {
      issueNumber: issue.number,
    });

    try {
      // 1. Check for an existing open PR before provisioning
      const branchName = this.worktreeManager.resolveBranchName(issue.number, issue.title);
      try {
        const existingPR = await this.platform.findOpenPR(issue.number, branchName);
        if (existingPR !== null) {
          this.logger.info(
            `Skipping issue #${issue.number}: existing open PR found at ${existingPR.url}`,
            { issueNumber: issue.number },
          );
          this.prCompletionQueue.enqueue({
            issueNumber: issue.number,
            issueTitle: issue.title,
            prNumber: existingPR.number,
            prUrl: existingPR.url,
            branch: branchName,
            dependencyIssueNumbers: dag ? dag.getDirectDeps(issue.number) : [],
          });
          // Mark code-complete (not completed) — the completion queue will
          // promote to 'completed' only after the PR is actually merged.
          // If auto-complete is disabled the queue is a no-op and the PR
          // stays open, so code-complete is still the correct status.
          await this.fleetCheckpoint.setIssueStatus(
            issue.number,
            'code-complete',
            '',
            branchName,
            0,
            issue.title,
          );
          return {
            issueNumber: issue.number,
            issueTitle: issue.title,
            success: true,
            codeComplete: false,
            pr: existingPR,
            phases: [],
            totalDuration: 0,
            tokenUsage: 0,
          };
        }

        // 1b. Check for an already-merged PR (e.g. merged since the last run)
        const allPRs = await this.platform.listPullRequests({ head: branchName, state: 'all' });
        const mergedPR = allPRs.find((pr) => pr.state === 'merged');
        if (mergedPR) {
          this.logger.info(
            `Skipping issue #${issue.number}: PR #${mergedPR.number} is already merged`,
            { issueNumber: issue.number },
          );
          await this.fleetCheckpoint.setIssueStatus(
            issue.number,
            'completed',
            '',
            branchName,
            0,
            issue.title,
          );
          return {
            issueNumber: issue.number,
            issueTitle: issue.title,
            success: true,
            codeComplete: false,
            pr: mergedPR,
            phases: [],
            totalDuration: 0,
            tokenUsage: 0,
          };
        }
      } catch (prErr) {
        this.logger.warn(
          `Could not check for existing PR for issue #${issue.number}: ${prErr}`,
          { issueNumber: issue.number },
        );
      }

      // 2. Provision worktree
      let worktree: WorktreeInfo;
      if (dag) {
        const transitiveDeps = dag.getTransitiveDepsOrdered(issue.number);
        if (transitiveDeps.length > 0) {
          try {
            worktree = await this.worktreeManager.provisionWithDeps(
              issue.number,
              issue.title,
              transitiveDeps,
              this.config.options.resume,
              this.config.dag?.onDependencyMergeConflict === 'resolve'
                ? (ctx: DependencyMergeConflictContext) => this.resolveDagDependencyMergeConflict(issue, ctx)
                : undefined,
            );
          } catch (err) {
            if (err instanceof DependencyMergeConflictError) {
              const error = String(err);
              this.logger.warn(
                `Dependency merge conflict for issue #${issue.number}: ${error}`,
                { issueNumber: issue.number },
              );
              await this.fleetCheckpoint.setIssueStatus(
                issue.number,
                'dep-merge-conflict',
                '',
                branchName,
                0,
                issue.title,
                error,
              );
              return {
                issueNumber: issue.number,
                issueTitle: issue.title,
                success: false,
                codeComplete: false,
                phases: [],
                totalDuration: 0,
                tokenUsage: 0,
                error,
              };
            }
            throw err;
          }
        } else {
          worktree = await this.worktreeManager.provision(
            issue.number,
            issue.title,
            this.config.options.resume,
          );
        }
      } else {
        worktree = await this.worktreeManager.provision(
          issue.number,
          issue.title,
          this.config.options.resume,
        );
      }

      // 3. Update fleet checkpoint
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'in-progress',
        worktree.path,
        worktree.branch,
        0,
        issue.title,
      );

      // 4. Set up per-issue progress directory
      const progressDir = join(
        worktree.path,
        '.cadre',
        'issues',
        String(issue.number),
      );

      // 4. Create per-issue checkpoint manager
      const checkpoint = new CheckpointManager(progressDir, this.logger);
      await checkpoint.load(String(issue.number));
      await checkpoint.setWorktreeInfo(
        worktree.path,
        worktree.branch,
        worktree.baseCommit,
      );

      // 5. Create per-issue orchestrator
      const issueOrchestrator = new IssueOrchestrator(
        this.config,
        issue,
        worktree,
        checkpoint,
        this.launcher,
        this.platform,
        this.logger.child(issue.number, join(this.cadreDir, 'logs')),
        this.notifications,
      );

      // 6. Run the 5-phase pipeline
      const result = await issueOrchestrator.run();

      // 7. Update fleet checkpoint
      // When auto-complete is enabled and a PR was created, mark 'code-complete'
      // instead of 'completed' — the completion queue promotes to 'completed'
      // only after the PR is actually merged.
      const willEnqueueForCompletion = this.autoCompleteEnabled && result.pr?.number != null && result.success;
      const status = result.budgetExceeded
        ? 'budget-exceeded'
        : result.success
          ? (willEnqueueForCompletion ? 'code-complete' : 'completed')
          : result.codeComplete
            ? 'code-complete'
            : 'failed';
      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        status,
        worktree.path,
        worktree.branch,
        result.phases.length,
        issue.title,
        result.error,
      );

      // Fix 2: Enqueue newly-created PRs into the serial completion queue.
      // Previously each issue merged inline during Phase 5, causing parallel
      // merge races.  Now all merges go through the completion queue which
      // processes them serially in DAG order.
      if (result.pr?.number != null && result.success) {
        this.prCompletionQueue.enqueue({
          issueNumber: issue.number,
          issueTitle: issue.title,
          prNumber: result.pr.number,
          prUrl: result.pr.url,
          branch: worktree.branch,
          dependencyIssueNumbers: dag ? dag.getDirectDeps(issue.number) : [],
        });
      }

      // 8. Record token usage
      if (result.tokenUsage !== null) {
        this.tokenTracker.record(issue.number, 'total', 0, result.tokenUsage);
        await this.fleetCheckpoint.recordTokenUsage(issue.number, result.tokenUsage);
      }

      // 9. Check budget
      const budgetStatus = this.tokenTracker.checkFleetBudget(
        this.config.options.tokenBudget,
      );
      if (budgetStatus === 'exceeded') {
        this.fleetBudgetExceeded = true;
        this.logger.error('Fleet token budget exceeded — pausing', {
          data: {
            current: this.tokenTracker.getTotal(),
            budget: this.config.options.tokenBudget,
          },
        });
        await this.eventBus.dispatchBudgetExceeded(
          this.tokenTracker.getTotal(),
          this.config.options.tokenBudget ?? 0,
        );
      } else if (budgetStatus === 'warning') {
        const current = this.tokenTracker.getTotal();
        const budget = this.config.options.tokenBudget ?? 0;
        await this.eventBus.dispatchBudgetWarning(
          current,
          budget,
          budget > 0 ? Math.round((current / budget) * 100) : 0,
        );
      }

      // Update progress
      await this.reporter.writeFleetProgressIncremental();

      return result;
    } catch (err) {
      if (err instanceof RemoteBranchMissingError) {
        const error = `Skipping issue #${issue.number}: remote branch is missing — ${err.message}`;
        this.logger.warn(error, { issueNumber: issue.number });
        await this.fleetCheckpoint.setIssueStatus(
          issue.number,
          'failed',
          '',
          '',
          0,
          error,
        );
        return {
          issueNumber: issue.number,
          issueTitle: issue.title,
          success: false,
          codeComplete: false,
          phases: [],
          totalDuration: 0,
          tokenUsage: 0,
          error,
        };
      }

      const error = String(err);
      this.logger.error(`Issue #${issue.number} failed: ${error}`, {
        issueNumber: issue.number,
      });

      await this.fleetCheckpoint.setIssueStatus(
        issue.number,
        'failed',
        '',
        '',
        0,
        issue.title,
        error,
      );

      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        success: false,
        codeComplete: false,
        phases: [],
        totalDuration: 0,
        tokenUsage: 0,
        error,
      };
    }
  }

  private async resolveDagDependencyMergeConflict(
    issue: IssueDetail,
    context: DependencyMergeConflictContext,
  ): Promise<boolean> {
    const progressDir = join(this.cadreDir, 'issues', String(issue.number));
    await ensureDir(progressDir);

    this.logger.info(
      `DAG dependency merge conflict detected for issue #${issue.number}; launching dep-conflict-resolver`,
      { issueNumber: issue.number, data: { conflictedFiles: context.conflictedFiles, conflictingBranch: context.conflictingBranch } },
    );

    const conflictContextPath = await this.contextBuilder.build('dep-conflict-resolver', {
      issueNumber: issue.number,
      worktreePath: context.depsWorktreePath,
      conflictedFiles: context.conflictedFiles,
      conflictingBranch: context.conflictingBranch,
      depsBranch: context.depsBranch,
      progressDir,
    });

    const resolverResult = await this.launcher.launchAgent(
      {
        agent: 'dep-conflict-resolver',
        issueNumber: issue.number,
        phase: 0,
        contextPath: conflictContextPath,
        outputPath: join(progressDir, 'dep-conflict-resolution-report.md'),
      },
      context.depsWorktreePath,
    );

    if (!resolverResult.success || !resolverResult.outputExists) {
      this.logger.warn(
        `dep-conflict-resolver failed for issue #${issue.number}; proceeding with dep-merge-conflict fallback`,
        {
          issueNumber: issue.number,
          data: {
            timedOut: resolverResult.timedOut,
            exitCode: resolverResult.exitCode,
            outputExists: resolverResult.outputExists,
          },
        },
      );
      return false;
    }

    this.logger.info(`dep-conflict-resolver completed for issue #${issue.number}`, {
      issueNumber: issue.number,
      data: { outputPath: resolverResult.outputPath },
    });
    return true;
  }

  /**
   * Mark a single issue as dep-blocked in the fleet checkpoint and return a failed IssueResult.
   */
  private async markIssueDepBlocked(issue: IssueDetail): Promise<IssueResult> {
    this.logger.info(`Marking issue #${issue.number} as dep-blocked`, { issueNumber: issue.number });
    await this.fleetCheckpoint.setIssueStatus(
      issue.number,
      'dep-blocked',
      '',
      '',
      0,
      issue.title,
      'Blocked by dependency failure',
    );
    return {
      issueNumber: issue.number,
      issueTitle: issue.title,
      success: false,
      codeComplete: false,
      phases: [],
      totalDuration: 0,
      tokenUsage: 0,
      error: 'dep-blocked',
    };
  }
}
