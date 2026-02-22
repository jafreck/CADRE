# Test Result: task-002 - Align FleetResult.tokenUsage with TokenSummary and handle null in processIssue

## Tests Written

- `tests/fleet-result.test.ts`: 5 new test cases
  - FleetResult.tokenUsage: should accept a TokenSummary with byPhase and recordCount
  - FleetResult.tokenUsage: should accept an empty TokenSummary with zero values
  - CadreRuntime.emptyResult(): should return a FleetResult with a complete TokenSummary including byPhase and recordCount
  - CadreRuntime.emptyResult(): should return tokenUsage with byPhase as an empty object (not undefined)
  - CadreRuntime.emptyResult(): should return tokenUsage with recordCount of 0 (not undefined)

- `tests/issue-orchestrator.test.ts` (pre-existing, covers task-003 which overlaps task-002 null guard concern):
  - recordTokens() null-safety guard: should not record tokens when tokenUsage is null
  - recordTokens() null-safety guard: should not record tokens when tokenUsage is 0
  - recordTokens() null-safety guard: should record tokens when tokenUsage is a positive number
  - buildResult() includes pr field: should populate IssueResult.pr after successful PR creation
  - buildResult() includes pr field: should leave IssueResult.pr undefined when autoCreate is disabled
  - buildResult() includes pr field: should leave IssueResult.pr undefined when PR creation throws
  - launchWithRetry() fallback tokenUsage is null: should return tokenUsage: null when all retries are exhausted

## Test Files Modified
- (none)

## Test Files Created
- tests/fleet-result.test.ts

## Coverage Notes
- The null guard for `tokenTracker.record()` in `processIssue()` (fleet-orchestrator.ts) cannot be unit-tested without running the full pipeline since it creates internal `IssueOrchestrator` instances. The analogous guard in `IssueOrchestrator.recordTokens()` is covered by `tests/issue-orchestrator.test.ts`.
- `CadreRuntime.emptyResult()` is a private method tested via `(runtime as unknown as {...}).emptyResult()`. This directly verifies the fix that added `byPhase: {}` and `recordCount: 0` to the returned `TokenSummary`.
- `FleetResult.tokenUsage` type alignment with `TokenSummary` is verified at both the type and runtime shape level.
