# Task Result: task-008 - Write cost-report.json and Post Issue Comment in IssueOrchestrator

## Changes Made
- `src/core/issue-orchestrator.ts`: 
  - Added imports for `CostEstimator` from `../budget/cost-estimator.js` and `CostReport`, `CostReportAgentEntry`, `CostReportPhaseEntry` from `../reporting/types.js`
  - Added `readonly costEstimator: CostEstimator` field and initialized it in constructor
  - Refactored `run()` to delegate to private `runPipeline()`, wrapping it in a try/finally that always calls `writeCostReport()`
  - Added `writeCostReport()` private method: builds a `CostReport` using `CostEstimator.estimateDetailed()` when input/output split is available (via `TokenRecord.input`/`.output`), falls back to `estimate()` otherwise, writes to `<progressDir>/cost-report.json`, and optionally posts a cost comment via `platform.addIssueComment()`
  - Added `formatCostComment()` private method to produce a Markdown summary with by-agent and by-phase tables

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- Pre-existing build error (`tokenUsage: number | null` vs `number` in notification dispatch) was present before this task and is not related to this task's scope
- All 839 previously passing tests continue to pass; 34 pre-existing failures are unchanged
- `writeCostReport()` is called in a finally block so it runs on both success and failure paths
- If `config.options.postCostComment` is false (the default), no GitHub comment is posted
