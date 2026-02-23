# Test Result: task-008 - Write cost-report.json and Post Issue Comment in IssueOrchestrator

## Tests Written
- `tests/issue-orchestrator.test.ts`: 9 new test cases in `IssueOrchestrator – cost report` describe block
  - should write cost-report.json after a successful run
  - should write cost-report.json even when a critical phase fails (finally block)
  - should produce a cost report conforming to the CostReport interface
  - should call addIssueComment when postCostComment is true
  - should NOT call addIssueComment when postCostComment is false (default)
  - should use estimateDetailed when token records have input/output split
  - should fall back to estimate when token records have no input/output split
  - should include agent and phase breakdowns in byAgent and byPhase
  - formatCostComment should produce markdown with cost summary sections

## Test Files Modified
- tests/issue-orchestrator.test.ts

## Test Files Created
- (none)

## Coverage Notes
- `writeCostReport()` is private; tests exercise it indirectly via `run()` by inspecting `atomicWriteJSON` call arguments and `platform.addIssueComment` invocations.
- The `TokenTracker` module mock is overridden per-test using `vi.mocked(TokenTracker).mockImplementationOnce(...)` to simulate records with and without input/output split.
- The `makePlatform()` helper was extended to include `addIssueComment: vi.fn()`, and the `TokenTracker` mock was extended with `getRecords`, `getByPhase`, `getSummary`, and `checkIssueBudget` methods to satisfy the new code paths.
- No direct unit test for `formatCostComment` (private method); its output is verified through the `addIssueComment` argument in the `postCostComment: true` test.
