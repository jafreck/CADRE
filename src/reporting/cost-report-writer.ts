import { join } from 'node:path';
import { CostEstimator } from '../budget/cost-estimator.js';
import { ISSUE_PHASES } from '../core/phase-registry.js';
import { atomicWriteJSON } from '../util/fs.js';
import type { TokenTracker, TokenRecord } from '../budget/token-tracker.js';
import type { CostReport, CostReportAgentEntry, CostReportPhaseEntry } from './types.js';

export class CostReportWriter {
  constructor(private readonly costEstimator: CostEstimator) {}

  /**
   * Build a CostReport from TokenTracker records.
   */
  build(issueNumber: number, tokenTracker: TokenTracker, model: string): CostReport {
    const records = tokenTracker
      .exportRecords()
      .filter((r) => r.issueNumber === issueNumber);

    // Aggregate byAgent
    const agentMap = new Map<
      string,
      { tokens: number; inputTokens: number; outputTokens: number }
    >();
    for (const r of records) {
      const existing = agentMap.get(r.agent) ?? { tokens: 0, inputTokens: 0, outputTokens: 0 };
      agentMap.set(r.agent, {
        tokens: existing.tokens + r.tokens,
        inputTokens: existing.inputTokens + (r.input ?? 0),
        outputTokens: existing.outputTokens + (r.output ?? 0),
      });
    }

    const byAgent: CostReportAgentEntry[] = Array.from(agentMap.entries()).map(
      ([agent, agg]) => {
        const costEst =
          agg.inputTokens > 0 || agg.outputTokens > 0
            ? this.costEstimator.estimateDetailed(agg.inputTokens, agg.outputTokens, model)
            : this.costEstimator.estimate(agg.tokens, model);
        return {
          agent,
          tokens: agg.tokens,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          estimatedCost: costEst.totalCost,
        };
      },
    );

    // Aggregate byPhase
    const phaseMap = new Map<number, { tokens: number; inputTokens: number; outputTokens: number }>();
    for (const r of records) {
      const existing = phaseMap.get(r.phase) ?? { tokens: 0, inputTokens: 0, outputTokens: 0 };
      phaseMap.set(r.phase, {
        tokens: existing.tokens + r.tokens,
        inputTokens: existing.inputTokens + (r.input ?? 0),
        outputTokens: existing.outputTokens + (r.output ?? 0),
      });
    }

    const byPhase: CostReportPhaseEntry[] = ISSUE_PHASES.map((phase) => {
      const agg = phaseMap.get(phase.id) ?? { tokens: 0, inputTokens: 0, outputTokens: 0 };
      const costEst =
        agg.inputTokens > 0 || agg.outputTokens > 0
          ? this.costEstimator.estimateDetailed(agg.inputTokens, agg.outputTokens, model)
          : this.costEstimator.estimate(agg.tokens, model);
      return {
        phase: phase.id,
        phaseName: phase.name,
        tokens: agg.tokens,
        estimatedCost: costEst.totalCost,
      };
    });

    // Overall totals
    const totalTokens = records.reduce((sum, r) => sum + r.tokens, 0);
    const totalInput = records.reduce((sum, r) => sum + (r.input ?? 0), 0);
    const totalOutput = records.reduce((sum, r) => sum + (r.output ?? 0), 0);

    const overallCost =
      totalInput > 0 || totalOutput > 0
        ? this.costEstimator.estimateDetailed(totalInput, totalOutput, model)
        : this.costEstimator.estimate(totalTokens, model);

    return {
      issueNumber,
      generatedAt: new Date().toISOString(),
      totalTokens,
      inputTokens: overallCost.inputTokens,
      outputTokens: overallCost.outputTokens,
      estimatedCost: overallCost.totalCost,
      model,
      byAgent,
      byPhase,
    };
  }

  /**
   * Write a CostReport as JSON to `{progressDir}/cost-report.json` atomically.
   */
  async write(report: CostReport, progressDir: string): Promise<void> {
    const filePath = join(progressDir, 'cost-report.json');
    await atomicWriteJSON(filePath, report);
  }
}
