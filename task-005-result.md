# Task Result: task-005 - Thread ZodError Validation Failures into Retry Context in IssueOrchestrator

## Changes Made
- `src/core/issue-orchestrator.ts`: Added `ZodError` import from `zod`
- `src/core/issue-orchestrator.ts`: Wrapped `resultParser.parseReview()` call inside `executeTask`'s retry loop with try/catch; on `ZodError`, logs formatted validation error at `warn` level and re-throws so `RetryExecutor` retries
- `src/core/issue-orchestrator.ts`: Fixed pre-existing type error (`number | null` → `number`) for `tokenUsage` in notification dispatch using nullish coalescing

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- Only `parseReview` was called inside a `retryExecutor.execute` fn; other parse calls (`parseImplementationPlan`, `parsePRContent`) are outside retry loops
- Non-ZodError failures propagate unchanged via the second `throw err`
- The pre-existing `TS2322` type error at the notification dispatch was fixed as it blocked `npm run build`
