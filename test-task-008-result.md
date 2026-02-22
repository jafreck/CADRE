# Test Result: task-008 - Inject NotificationManager into IssueOrchestrator

## Tests Written
- `tests/issue-orchestrator.test.ts`: 12 new test cases
  - should construct without a notificationManager
  - should construct with a notificationManager
  - should dispatch issue-started when notificationManager is provided
  - should dispatch issue-completed on successful pipeline
  - should include duration and tokenUsage in issue-completed event
  - should not throw when notificationManager is absent
  - should return a successful IssueResult when all phases already completed
  - should dispatch issue-failed when a critical phase fails
  - should include the failing phase id in the issue-failed event
  - should not throw when notificationManager is absent and a critical phase fails
  - should not dispatch issue-completed when pipeline fails
  - should dispatch issue-started before issue-completed

## Test Files Modified
- (none)

## Test Files Created
- tests/issue-orchestrator.test.ts

## Coverage Notes
- The full phase execution pipeline (phases 1–5) is not exercised end-to-end due to the heavy dependency chain (AgentLauncher, ContextBuilder, ResultParser, etc.). Tests instead use checkpoint mocking to fast-path through the loop.
- The critical-phase-failure path is triggered by making `ensureDir` (called inside the `executePhase` try block for phase 1) reject, which causes a `{ success: false }` phase result and the `issue-failed` dispatch.
- `budget-warning` / `budget-exceeded` events remain untested in IssueOrchestrator as confirmed by task-008: those events are not dispatched by IssueOrchestrator.
