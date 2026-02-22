# Test Result: task-009 - Wire NotificationManager in CadreRuntime

## Tests Written
- `tests/runtime.test.ts`: 10 new test cases

### CadreRuntime — NotificationManager wiring (3)
- calls createNotificationManager with the config in the constructor
- passes the NotificationManager instance to FleetOrchestrator
- returns an empty FleetResult when no issues are resolved

### CadreRuntime — shutdown handler dispatches fleet-interrupted (7)
- registers SIGINT and SIGTERM handlers on run()
- dispatches fleet-interrupted with SIGINT signal on SIGINT
- dispatches fleet-interrupted with SIGTERM signal on SIGTERM
- includes active issue numbers in fleet-interrupted event
- calls process.exit(130) on SIGINT
- calls process.exit(143) on SIGTERM
- does not dispatch fleet-interrupted twice if handler is called multiple times

## Test Files Modified
- (none)

## Test Files Created
- tests/runtime.test.ts

## Coverage Notes
- `CadreRuntime` is heavily side-effectful (Logger, platform provider, process signals) so all dependencies are mocked via `vi.mock`.
- The shutdown handler uses `() => void handler(signal)` to fire-and-forget the async handler; tests use a `flushAsync()` helper (20ms setTimeout) to drain the async work before asserting.
- Both describe blocks spy on `process.on` to prevent real SIGINT/SIGTERM listeners from leaking onto the process (which would cause unhandled rejections when vitest sends SIGTERM during teardown).
- The `isShuttingDown` guard (double-call test) is verified by calling the signal handler twice and asserting `fleet-interrupted` is dispatched only once.
