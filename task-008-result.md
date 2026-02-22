# Task Result: task-008 - Inject NotificationManager into IssueOrchestrator

## Changes Made
- `src/core/issue-orchestrator.ts`: Imported `NotificationManager` from `../notifications/manager.js`
- `src/core/issue-orchestrator.ts`: Added optional `notificationManager?: NotificationManager` as the last constructor parameter
- `src/core/issue-orchestrator.ts`: Dispatched `issue-started` event after pipeline start log in `run()`
- `src/core/issue-orchestrator.ts`: Dispatched `issue-failed` event before returning on critical phase failure in `run()`
- `src/core/issue-orchestrator.ts`: Dispatched `issue-completed` event before returning on successful completion in `run()`

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- The `notificationManager` parameter is optional; all dispatch calls use optional chaining (`?.`) so existing callers without the parameter are unaffected.
- `issue-completed` is dispatched using the result built by `buildResult()` to ensure `duration` and `tokenUsage` are consistent.
- `budget-warning` / `budget-exceeded` events are not dispatched as there is no per-issue budget check in the current `run()` implementation.
