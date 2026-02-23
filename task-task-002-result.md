# Task Result: task-002 - Create `IssueNotifier` Class

## Changes Made
- `src/core/issue-notifier.ts`: Created new file exporting the `IssueNotifier` class with all five public `notify*` methods.

## Files Modified
- (none)

## Files Created
- src/core/issue-notifier.ts

## Notes
- Constructor accepts `CadreConfig`, `PlatformProvider`, and `Logger`.
- All five methods (`notifyStart`, `notifyPhaseComplete`, `notifyComplete`, `notifyFailed`, `notifyBudgetWarning`) return `Promise<void>`.
- Each method short-circuits when `issueUpdates.enabled` is false or when the specific flag is false.
- Errors from `platform.addIssueComment()` are caught in the private `post()` helper and passed to `logger.warn()` — methods always resolve.
- `notifyComplete` includes the PR URL and token usage when provided.
- `notifyFailed` includes phase number/name and failed task ID when provided.
- `notifyBudgetWarning` includes both consumed and total token counts with percentage.
