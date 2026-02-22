import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CadreConfig } from '../config/schema.js';
import type { FleetResult } from '../core/fleet-orchestrator.js';
import type { IssueDetail } from '../platform/provider.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { ISSUE_PHASES } from '../core/phase-registry.js';
import { atomicWriteJSON, ensureDir, readJSON } from '../util/fs.js';
import type { RunReport, RunIssueSummary, RunPhaseSummary, RunTotals } from './types.js';

export class ReportWriter {
  constructor(
    private readonly config: CadreConfig,
    private readonly costEstimator: CostEstimator,
  ) {}

  /**
   * Assemble a RunReport from fleet execution results.
   */
  buildReport(
    result: FleetResult,
    issues: IssueDetail[],
    startTime: number,
  ): RunReport {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Map per-issue results to RunIssueSummary
    const issueSummaries: RunIssueSummary[] = result.issues.map((ir) => ({
      issueNumber: ir.issueNumber,
      issueTitle: ir.issueTitle,
      success: ir.success,
      prNumber: ir.pr?.number,
      tokens: ir.tokenUsage,
      duration: ir.totalDuration,
      error: ir.error,
    }));

    // Derive per-phase summaries from byPhase token usage
    const byPhase = result.tokenUsage.byPhase;
    const phases: RunPhaseSummary[] = ISSUE_PHASES.map((phase) => {
      const tokens = byPhase[phase.id] ?? 0;
      const costEstimate = this.costEstimator.estimate(tokens, this.config.copilot.model);
      return {
        id: String(phase.id),
        name: phase.name,
        duration: 0,
        tokens,
        estimatedCost: costEstimate.totalCost,
      };
    });

    const totalCostEstimate = this.costEstimator.estimate(
      result.tokenUsage.total,
      this.config.copilot.model,
    );

    const prsCreated = result.prsCreated.length;
    const failures = result.failedIssues.length;

    const totals: RunTotals = {
      tokens: result.tokenUsage.total,
      estimatedCost: totalCostEstimate.totalCost,
      issues: result.issues.length,
      prsCreated,
      failures,
    };

    return {
      runId: randomUUID(),
      project: this.config.projectName,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      duration,
      issues: issueSummaries,
      phases,
      totalTokens: result.tokenUsage.total,
      estimatedCost: totalCostEstimate.totalCost,
      prsCreated,
      totals,
    };
  }

  /**
   * Write the report as a timestamped JSON file to `.cadre/reports/`.
   * Returns the path of the written file.
   */
  async write(report: RunReport): Promise<string> {
    const reportsDir = join(this.config.repoPath, '.cadre', 'reports');
    await ensureDir(reportsDir);

    const timestamp = report.startTime.replace(/[:.]/g, '-');
    const fileName = `run-report-${timestamp}.json`;
    const filePath = join(reportsDir, fileName);

    await atomicWriteJSON(filePath, report);
    return filePath;
  }

  /**
   * List all run report files in `.cadre/reports/` sorted alphabetically.
   * ISO timestamps in filenames sort lexicographically (newest last).
   */
  static async listReports(cadreDir: string): Promise<string[]> {
    const reportsDir = join(cadreDir, 'reports');
    let entries: string[];
    try {
      entries = await readdir(reportsDir);
    } catch {
      return [];
    }

    return entries
      .filter((name) => name.startsWith('run-report-') && name.endsWith('.json'))
      .sort()
      .map((name) => join(reportsDir, name));
  }

  /**
   * Read and parse a report file.
   */
  static async readReport(filePath: string): Promise<RunReport> {
    return readJSON<RunReport>(filePath);
  }
}
