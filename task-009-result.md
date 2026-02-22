# Task Result: task-009 - Wire NotificationManager in CadreRuntime

## Changes Made
- `src/core/runtime.ts`: Imported `createNotificationManager` and `NotificationManager` from `../notifications/manager.js`
- `src/core/runtime.ts`: Added `notifications: NotificationManager` private field, instantiated via `createNotificationManager(config)` in constructor
- `src/core/runtime.ts`: Added `activeIssueNumbers: number[]` private field, populated after resolving issues
- `src/core/runtime.ts`: Passed `this.notifications` to `FleetOrchestrator` constructor
- `src/core/runtime.ts`: Dispatched `fleet-interrupted` event (with `signal` and `issuesInProgress`) in shutdown handler before `process.exit`

## Files Modified
- src/core/runtime.ts

## Files Created
- (none)

## Notes
- `activeIssueNumbers` is populated after `resolveIssues()` so the shutdown handler can reference which issues were being processed
- `FleetOrchestrator` already accepted `NotificationManager` as an optional last parameter; we now pass the real instance from config
