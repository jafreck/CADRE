import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { CostReportWriter } from '../src/reporting/cost-report-writer.js';
import { CostEstimator } from '../src/budget/cost-estimator.js';
import { TokenTracker } from '../src/budget/token-tracker.js';
import { ISSUE_PHASES } from '../src/core/phase-registry.js';

vi.mock('../src/util/fs.js', () => ({
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
}));

import * as fsUtil from '../src/util/fs.js';

const makeCostEstimator = () =>
  new CostEstimator({
    cliCommand: 'copilot',
    model: 'gpt-4o',
    agentDir: 'agents',
    timeout: 300_000,
  });

describe('CostReportWriter', () => {
  let writer: CostReportWriter;
  let tracker: TokenTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    writer = new CostReportWriter(makeCostEstimator());
    tracker = new TokenTracker();
  });

  describe('build', () => {
    it('returns a CostReport with the correct top-level fields', () => {
      tracker.record(1, 'scout', 1, 500);
      const report = writer.build(1, tracker, 'gpt-4o');

      expect(report.issueNumber).toBe(1);
      expect(report.model).toBe('gpt-4o');
      expect(typeof report.generatedAt).toBe('string');
      expect(report.totalTokens).toBe(500);
      expect(typeof report.estimatedCost).toBe('number');
    });

    it('aggregates byAgent with agent, tokens, inputTokens, outputTokens, estimatedCost', () => {
      tracker.importRecords([
        { issueNumber: 1, agent: 'scout', phase: 1, tokens: 300, timestamp: '', input: 200, output: 100 },
        { issueNumber: 1, agent: 'scout', phase: 2, tokens: 200, timestamp: '', input: 150, output: 50 },
        { issueNumber: 1, agent: 'coder', phase: 3, tokens: 400, timestamp: '', input: 300, output: 100 },
      ]);

      const report = writer.build(1, tracker, 'gpt-4o');

      const scout = report.byAgent.find((e) => e.agent === 'scout');
      expect(scout).toBeDefined();
      expect(scout!.tokens).toBe(500);
      expect(scout!.inputTokens).toBe(350);
      expect(scout!.outputTokens).toBe(150);
      expect(typeof scout!.estimatedCost).toBe('number');
      expect(scout!.estimatedCost).toBeGreaterThan(0);

      const coder = report.byAgent.find((e) => e.agent === 'coder');
      expect(coder).toBeDefined();
      expect(coder!.tokens).toBe(400);
    });

    it('aggregates byPhase with phase, phaseName, tokens, estimatedCost', () => {
      tracker.importRecords([
        { issueNumber: 1, agent: 'scout', phase: 1, tokens: 200, timestamp: '' },
        { issueNumber: 1, agent: 'planner', phase: 2, tokens: 300, timestamp: '' },
      ]);

      const report = writer.build(1, tracker, 'gpt-4o');

      expect(report.byPhase).toHaveLength(ISSUE_PHASES.length);

      const phase1 = report.byPhase.find((e) => e.phase === 1);
      expect(phase1).toBeDefined();
      expect(phase1!.phaseName).toBe(ISSUE_PHASES[0].name);
      expect(phase1!.tokens).toBe(200);
      expect(typeof phase1!.estimatedCost).toBe('number');

      const phase2 = report.byPhase.find((e) => e.phase === 2);
      expect(phase2!.tokens).toBe(300);
    });

    it('uses estimateDetailed when input/output are both non-zero on a TokenRecord', () => {
      const estimator = makeCostEstimator();
      const spyDetailed = vi.spyOn(estimator, 'estimateDetailed');
      const spyEstimate = vi.spyOn(estimator, 'estimate');

      const w = new CostReportWriter(estimator);
      tracker.importRecords([
        { issueNumber: 1, agent: 'scout', phase: 1, tokens: 300, timestamp: '', input: 200, output: 100 },
      ]);

      w.build(1, tracker, 'gpt-4o');

      expect(spyDetailed).toHaveBeenCalled();
    });

    it('uses estimate as fallback when input/output are absent', () => {
      const estimator = makeCostEstimator();
      const spyDetailed = vi.spyOn(estimator, 'estimateDetailed');
      const spyEstimate = vi.spyOn(estimator, 'estimate');

      const w = new CostReportWriter(estimator);
      tracker.importRecords([
        { issueNumber: 1, agent: 'scout', phase: 1, tokens: 300, timestamp: '' },
      ]);

      w.build(1, tracker, 'gpt-4o');

      // estimateDetailed should NOT have been called; estimate should have been
      expect(spyDetailed).not.toHaveBeenCalled();
      expect(spyEstimate).toHaveBeenCalled();
    });

    it('filters records to the specified issueNumber', () => {
      tracker.importRecords([
        { issueNumber: 1, agent: 'scout', phase: 1, tokens: 100, timestamp: '' },
        { issueNumber: 2, agent: 'scout', phase: 1, tokens: 9999, timestamp: '' },
      ]);

      const report = writer.build(1, tracker, 'gpt-4o');
      expect(report.totalTokens).toBe(100);
    });

    it('returns zero tokens for an issue with no records', () => {
      const report = writer.build(42, tracker, 'gpt-4o');
      expect(report.issueNumber).toBe(42);
      expect(report.totalTokens).toBe(0);
      expect(report.byAgent).toHaveLength(0);
    });
  });

  describe('write', () => {
    it('writes to {progressDir}/cost-report.json atomically', async () => {
      tracker.record(1, 'scout', 1, 100);
      const report = writer.build(1, tracker, 'gpt-4o');
      const progressDir = '/some/dir/.cadre/issues/1';

      await writer.write(1, report, progressDir);

      const expectedPath = join(progressDir, 'cost-report.json');
      expect(fsUtil.atomicWriteJSON).toHaveBeenCalledWith(expectedPath, report);
    });

    it('written JSON contains correct issueNumber and totalTokens', async () => {
      tracker.importRecords([
        { issueNumber: 7, agent: 'coder', phase: 3, tokens: 750, timestamp: '' },
      ]);
      const report = writer.build(7, tracker, 'gpt-4o');
      const progressDir = '/tmp/cadre/issues/7';

      await writer.write(7, report, progressDir);

      const [, writtenData] = vi.mocked(fsUtil.atomicWriteJSON).mock.calls[0] as [string, typeof report];
      expect(writtenData.issueNumber).toBe(7);
      expect(writtenData.totalTokens).toBe(750);
    });
  });
});
