# Test Result: task-005 - Enforce fleet budget cancellation in `FleetOrchestrator`

## Tests Written
- `tests/fleet-orchestrator.test.ts`: 13 new test cases
  - constructor: should instantiate without throwing
  - run() - basic flow: should return a FleetResult with success when all issues succeed
  - run() - basic flow: should include totalDuration in the result
  - run() - basic flow: should process all issues in the fleet
  - fleetBudgetExceeded flag: should skip subsequent issues when fleet budget is exceeded by a prior issue
  - fleetBudgetExceeded flag: should report budget-exceeded issues as failures in the fleet result
  - pre-flight budget estimation: should skip issue when estimated tokens would exceed remaining budget
  - pre-flight budget estimation: should warn when pre-flight estimation causes a skip
  - pre-flight budget estimation: should allow issue to proceed when estimated tokens are within remaining budget
  - pre-flight budget estimation: should not apply pre-flight check when tokenBudget is not configured
  - run() with resume option: should skip already-completed issues when resume is enabled
  - aggregateResults: should set success=false when any issue fails
  - aggregateResults: should collect PRs from successful issues

## Test Files Created
- `tests/fleet-orchestrator.test.ts`

## Test Files Modified
- (none)

## Coverage Notes
- `FleetCheckpointManager`, `FleetProgressWriter`, `IssueOrchestrator`, and `WorktreeManager` are all mocked via `vi.mock()` since they depend on filesystem I/O and external processes.
- The `fleetBudgetExceeded` flag is tested indirectly through `run()` since `processIssue` is private; a budget of 4999 tokens against the 5000 returned by the mocked IssueOrchestrator triggers the flag for subsequent issues.
- Direct mutation of the private flag cannot be tested; tests rely on the budget enforcement path through `TokenTracker.checkFleetBudget`.
