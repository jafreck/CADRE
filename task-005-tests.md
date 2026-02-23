# Test Result: task-005 - Thread ZodError Validation Failures into Retry Context in IssueOrchestrator

## Tests Written
- `tests/issue-orchestrator-zod-retry.test.ts`: 7 new test cases
  - should log a warn with formatted ZodError message when parseReview throws ZodError
  - should include the field path and message from ZodError in the warn log
  - should include taskId in the warn log metadata when parseReview throws ZodError
  - should NOT call logger.warn with validation message when parseReview throws a non-ZodError
  - should re-throw ZodError so the retry executor records a failure attempt
  - should re-throw non-ZodError unchanged so retry executor captures it
  - should not call parseReview at all when the review file does not exist

## Test Files Modified
- (none)

## Test Files Created
- `tests/issue-orchestrator-zod-retry.test.ts`

## Coverage Notes
- Tests exercise `executeTask` end-to-end by running `orchestrator.run()` with phases 1, 2, 4, 5 pre-completed and a single task in the task queue.
- The `retryExecutor.execute` mock is configured to actually invoke `fn` (passthrough mode) so the ZodError catch block inside `executeTask` is exercised.
- The `TaskQueue.selectNonOverlappingBatch` static method must be added as a property on the mock constructor (via `Object.assign`) rather than as a module-level export, since the code calls it as `TaskQueue.selectNonOverlappingBatch(...)`.
- The `tokenTracker.checkIssueBudget` method must be mocked (returns `'ok'`) since `this.checkBudget()` is called at the start of the retry `fn` before reaching `parseReview`.
- Tests do not cover the case where `parseReview` is called multiple times across multiple retry attempts (the retry executor is mocked and only calls `fn` once per test).
