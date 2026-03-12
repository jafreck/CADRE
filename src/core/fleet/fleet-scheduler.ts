import pLimit from 'p-limit';
import type { IssueDetail, PullRequestInfo } from '../../platform/provider.js';
import type { IssueResult } from '../pipeline/issue-orchestrator.js';
import type { WorkItemDag, FleetCheckpointManager } from '@cadre-dev/framework/engine';
import type { PlatformProvider } from '../../platform/provider.js';
import type { RuntimeConfig } from '../../config/loader.js';
import { Logger } from '@cadre-dev/framework/core';
import { FlowRunner, defineFlow, step } from '@cadre-dev/framework/flow';
import type { FlowLifecycleHooks } from '@cadre-dev/framework/flow';
import { MergeRetryHelper } from '../merge/merge-retry.js';

/** Callback type for processing a single issue. */
export type ProcessIssueFn = (issue: IssueDetail, dag?: WorkItemDag<IssueDetail>) => Promise<IssueResult>;

/** Callback type for marking an issue as dep-blocked. */
export type MarkDepBlockedFn = (issue: IssueDetail) => Promise<IssueResult>;

/** Map issue number → a stable FlowNode id. */
function issueNodeId(num: number): string {
  return `issue-${num}`;
}

/** Reverse: extract issue number from a FlowNode id. */
function nodeIdToNumber(nodeId: string): number {
  return Number(nodeId.replace('issue-', ''));
}

/**
 * Handles bounded-parallelism and DAG wave scheduling for fleet issue pipelines.
 *
 * In DAG mode the scheduler delegates to `FlowRunner` with `concurrentNodes`
 * enabled, modelling each issue as a `step` FlowNode whose `dependsOn` edges
 * mirror the issue dependency map.  Upstream-failure propagation is handled by
 * the framework's `onUpstreamFailure` hook, which calls the `markDepBlocked`
 * callback supplied by the fleet orchestrator.
 */
export class FleetScheduler {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly issues: IssueDetail[],
    private readonly fleetCheckpoint: FleetCheckpointManager,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly dagDepMap?: Record<number, number[]>,
  ) {}

  /**
   * Schedule issue pipelines with either simple bounded parallelism or DAG ordering.
   */
  async schedule(
    issuesToProcess: IssueDetail[],
    processIssue: ProcessIssueFn,
    markDepBlocked: MarkDepBlockedFn,
    dag?: WorkItemDag<IssueDetail>,
  ): Promise<PromiseSettledResult<IssueResult>[]> {
    if (dag) {
      return this.runWithDag(dag, processIssue, markDepBlocked);
    }

    const limit = pLimit(this.config.options.maxParallelIssues);
    return Promise.allSettled(
      issuesToProcess.map((issue) =>
        limit(() => processIssue(issue)),
      ),
    );
  }

  /**
   * Execute all issues via FlowRunner when a DAG is present.
   *
   * Each issue becomes a `step` FlowNode.  `dependsOn` edges are derived
   * from `dagDepMap`, the framework handles topological scheduling and
   * upstream-failure propagation, and the `onUpstreamFailure` hook maps
   * to the existing `markDepBlocked` callback.
   */
  private async runWithDag(
    dag: WorkItemDag<IssueDetail>,
    processIssue: ProcessIssueFn,
    markDepBlocked: MarkDepBlockedFn,
  ): Promise<PromiseSettledResult<IssueResult>[]> {
    // ── Derive effective dep map ─────────────────────────────────────────
    // When dagDepMap is provided, use it directly.  Otherwise, derive it
    // from the DAG so that dependsOn edges are always wired correctly.
    const effectiveDepMap = this.dagDepMap ?? this.buildDepMapFromDag(dag);

    // ── Log DAG plan + persist to checkpoint ───────────────────────────
    const waves = dag.getWaves();
    const waveNumbers = waves.map((w) => w.map((i) => i.number));
    this.logger.info(
      `DAG plan: ${waveNumbers.map((w, i) => `Wave ${i} → [${w.map((n) => `#${n}`).join(', ')}]`).join(' | ')}`,
    );
    await this.fleetCheckpoint.setDag(
      Object.fromEntries(Object.entries(effectiveDepMap).map(([k, v]) => [String(k), v.map(String)])),
      waveNumbers.map((w) => w.map(String)),
    );

    // ── Identify resumed (already-completed) issues ────────────────────
    const issueMap = new Map(this.issues.map((i) => [i.number, i]));
    const completedFromResume = new Set<number>();
    if (this.config.options.resume) {
      for (const issue of this.issues) {
        if (this.fleetCheckpoint.isWorkItemCompleted(String(issue.number))) {
          completedFromResume.add(issue.number);
          this.logger.info(`Resume: issue #${issue.number} already completed`, { workItemId: String(issue.number) });
        }
      }
    }

    // ── Build per-issue result collector ────────────────────────────────
    const resultsMap = new Map<number, PromiseSettledResult<IssueResult>>();

    // ── Build one FlowNode step per issue ──────────────────────────────
    const flowNodes = this.issues.map((issue) => {
      const deps = (effectiveDepMap[issue.number] ?? [])
        .filter((dep) => issueMap.has(dep))
        .map(issueNodeId);

      return step<Record<string, unknown>>({
        id: issueNodeId(issue.number),
        name: `Issue #${issue.number}`,
        dependsOn: deps.length > 0 ? deps : undefined,
        run: async () => {
          // Execute the full per-issue pipeline
          let result: IssueResult;
          try {
            result = await processIssue(issue, dag);
          } catch (err) {
            resultsMap.set(issue.number, { status: 'rejected', reason: err });
            throw err;
          }

          // Always record as fulfilled (matches original scheduler semantics)
          resultsMap.set(issue.number, { status: 'fulfilled', value: result });

          // Check for dep-related failure statuses set during execution
          const depFailureStatuses = new Set(['dep-failed', 'dep-merge-conflict', 'dep-build-broken']);
          const cpStatus = this.fleetCheckpoint.getWorkItemStatus(String(issue.number));
          const isFailure = !result.success || (cpStatus && depFailureStatuses.has(cpStatus.status));

          if (isFailure) {
            // Throw so the framework marks this node as failed and
            // propagates upstream-failure to dependents.
            throw new Error(result.error ?? 'Issue failed');
          }

          // Auto-merge cadre-produced PRs (not pre-existing ones)
          if (this.config.dag?.autoMerge && result.success && result.codeComplete && result.pr) {
            const merged = await this.tryMergeWithRetry(result.pr, issue.number, issue.title);
            if (!merged) {
              throw new Error(`Merge failed after retries for PR #${result.pr.number}`);
            }
          }

          return result;
        },
      });
    });

    // ── Lifecycle hooks ────────────────────────────────────────────────
    const hooks: FlowLifecycleHooks<Record<string, unknown>> = {
      onUpstreamFailure: async (nodeId) => {
        const issueNumber = nodeIdToNumber(nodeId);
        const issue = issueMap.get(issueNumber);
        if (!issue) return;
        const result = await markDepBlocked(issue);
        resultsMap.set(issueNumber, { status: 'fulfilled', value: result });
        return result;
      },
    };

    // ── Build checkpoint adapter for resume ────────────────────────────
    const completedExecutionIds = [...completedFromResume].map(
      (num) => `fleet-dag/${issueNodeId(num)}`,
    );
    const checkpoint = completedExecutionIds.length > 0
      ? {
          load: async () => ({
            flowId: 'fleet-dag' as const,
            status: 'completed' as const,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedExecutionIds,
            outputs: {} as Record<string, unknown>,
            executionOutputs: {} as Record<string, unknown>,
          }),
          save: async () => {},
        }
      : undefined;

    // ── Run the flow ───────────────────────────────────────────────────
    const flow = defineFlow('fleet-dag', flowNodes, 'Fleet DAG issue scheduling');

    try {
      await new FlowRunner().run(flow, {}, {
        concurrency: this.config.options.maxParallelIssues,
        continueOnError: true,
        concurrentNodes: true,
        hooks,
        checkpoint,
      });
    } catch {
      // continueOnError should prevent this, but guard defensively
    }

    // ── Assemble results in issue order (excluding resumed) ────────────
    const allResults: PromiseSettledResult<IssueResult>[] = [];
    for (const issue of this.issues) {
      if (completedFromResume.has(issue.number)) continue;
      const result = resultsMap.get(issue.number);
      if (result) {
        allResults.push(result);
      }
    }

    return allResults;
  }

  /**
   * Attempt to merge a PR with retries, using the shared {@link MergeRetryHelper}
   * for server-side branch update + exponential backoff on dirty state.
   */
  private async tryMergeWithRetry(
    pr: PullRequestInfo,
    issueNumber: number,
    issueTitle: string,
  ): Promise<boolean> {
    const helper = new MergeRetryHelper(this.platform, this.logger, this.config.baseBranch);
    const merged = await helper.mergeWithRetry({
      prNumber: pr.number,
      prUrl: pr.url,
      branch: pr.headBranch,
      issueNumber,
    });

    if (!merged) {
      // Preserve the branch name so reconciliation can find the PR on next resume
      const existing = this.fleetCheckpoint.getWorkItemStatus(String(issueNumber));
      await this.fleetCheckpoint.setWorkItemStatus(
        String(issueNumber),
        'dep-merge-conflict',
        existing?.worktreePath ?? '',
        pr.headBranch,
        existing?.lastPhase ?? 0,
        issueTitle,
        `Merge failed after retries for PR #${pr.number}`,
      );
    }

    return merged;
  }

  /**
   * Derive a dep map from the DAG when no explicit `dagDepMap` was provided.
   * Uses `dag.getDirectDeps()` for each issue to build the same
   * `{ issueNumber: number[] }` structure.
   */
  private buildDepMapFromDag(dag: WorkItemDag<IssueDetail>): Record<number, number[]> {
    const depMap: Record<number, number[]> = {};
    for (const issue of this.issues) {
      const deps = dag.getDirectDeps(issue.number);
      if (deps.length > 0) {
        depMap[issue.number] = deps;
      }
    }
    return depMap;
  }
}
