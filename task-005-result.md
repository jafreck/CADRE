# Task Result: task-005 - Enforce fleet budget cancellation in `FleetOrchestrator`

## Changes Made
- `src/budget/cost-estimator.ts`: Re-added `estimateIssueTokens(historicalAvgTokens?: number): number` method (was accidentally removed by task-004's commit)
- `src/core/fleet-orchestrator.ts`:
  - Added `CostEstimator` import
  - Added `private costEstimator: CostEstimator` field and instantiated in constructor
  - Added `private fleetBudgetExceeded = false` flag
  - In `processIssue()`: added early return with `budget-exceeded` status when `fleetBudgetExceeded` is set
  - In `processIssue()`: added pre-flight estimation check — skips issue with warning if `currentTotal + estimate > tokenBudget`
  - In budget check block: sets `this.fleetBudgetExceeded = true` when `checkFleetBudget` returns `'exceeded'`

## Files Modified
- src/budget/cost-estimator.ts
- src/core/fleet-orchestrator.ts

## Files Created
- (none)

## Notes
- The `estimateIssueTokens` method had been removed by task-004's commit; it was restored as part of this task since task-005 depends on task-003
- In-progress issues are not affected by `fleetBudgetExceeded` — only issues that haven't started yet are skipped
- TypeScript compiles without errors
