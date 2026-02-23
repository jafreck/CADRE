# Task Result: task-003 - Wire `IssueNotifier` into `IssueOrchestrator`

## Changes Made
- `src/core/issue-orchestrator.ts`: Imported `IssueNotifier`, added `notifier` and `budgetWarningSent` private fields, instantiated `IssueNotifier` in the constructor, and wired all lifecycle notification calls.
- `tests/issue-orchestrator.test.ts`: Added `issueUpdates` (all disabled) to `makeConfig()` so existing tests continue to pass.

## Files Modified
- src/core/issue-orchestrator.ts
- tests/issue-orchestrator.test.ts

## Files Created
- (none)

## Notes
- All notification calls use `void` (fire-and-not-awaited) so orchestrator never crashes on notification failure.
- `notifyStart` fires after "Pipeline started" progress event.
- `notifyPhaseComplete` fires after each successful phase (inside the `phaseResult.success` branch).
- `notifyComplete` fires before returning the successful `buildResult`, passing `createdPR?.url` and current token total.
- `notifyFailed` fires before both failure return paths: budget exceeded and critical phase failure.
- `notifyBudgetWarning` is gated by `budgetWarningSent` flag to fire at most once per run, and only when `checkIssueBudget` returns `'warning'`.
- Test config uses `enabled: false` so no actual notifications fire during tests.
