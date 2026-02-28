import type { RuntimeConfig } from '../config/loader.js';
import { CostEstimator } from '../budget/cost-estimator.js';
import { ReportWriter } from '../reporting/report-writer.js';
import type { Logger } from '../logging/logger.js';

export class ReportService {
  private readonly cadreDir: string;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly _logger: Logger,
  ) {
    this.cadreDir = config.stateDir;
  }

  async report(options: { format?: 'json'; history?: boolean } = {}): Promise<void> {
    const paths = await ReportWriter.listReports(this.cadreDir);

    if (options.history) {
      if (paths.length === 0) {
        console.log('No reports found.');
        return;
      }
      for (const p of paths) {
        console.log(p);
      }
      return;
    }

    if (paths.length === 0) {
      console.log('No reports found.');
      return;
    }

    const mostRecent = paths[paths.length - 1];
    const run = await ReportWriter.readReport(mostRecent);

    if (options.format === 'json') {
      console.log(JSON.stringify(run));
      return;
    }

    const duration = (run.duration / 1000).toFixed(1);
    const estimator = new CostEstimator(this.config.agent.copilot);
    const costStr = estimator.format(estimator.estimate(run.totalTokens, this.config.agent.model));

    console.log('\n=== CADRE Run Report ===\n');
    console.log(`  Run ID:   ${run.runId}`);
    console.log(`  Project:  ${run.project}`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Issues:   ${run.totals.issues}`);
    console.log(`  PRs:      ${run.totals.prsCreated}`);
    console.log(`  Failures: ${run.totals.failures}`);
    console.log(`  Tokens:   ${run.totalTokens.toLocaleString()}`);
    console.log(`  Cost:     ${costStr}`);
    console.log('');
  }
}
