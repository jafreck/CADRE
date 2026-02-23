# Test Result: task-003 - Wire `IssueNotifier` into `IssueOrchestrator`

## Tests Written
- `tests/issue-orchestrator.test.ts`: 10 new test cases in new `IssueOrchestrator notifier integration` describe block
  - should call notifyStart once when pipeline starts
  - should call notifyPhaseComplete for each successfully completed phase when all phases run
  - should not call notifyPhaseComplete for already-completed (skipped) phases
  - should call notifyComplete when pipeline succeeds
  - should call notifyFailed when budget is exceeded
  - should call notifyFailed when a critical phase fails
  - should not call notifyComplete when pipeline fails
  - should not call notifyFailed when pipeline succeeds
  - should not crash when notifyStart rejects
  - should not crash when notifyFailed rejects

## Test Files Modified
- tests/issue-orchestrator.test.ts

## Test Files Created
- (none)

## Coverage Notes
- `notifyBudgetWarning` is not directly tested because it fires inside `recordTokens()`, which is only called deep within `executePhase` when actual agent results are returned. Mocking `executePhase` bypasses `recordTokens`, making budget-warning tests impractical without real phase execution. The fire-and-forget safety (no crash on rejection) is covered by the notifyFailed rejection test.
- All notification calls use `void` (fire-and-not-await), so rejection tests verify via `resolves` rather than by awaiting the notification itself.
