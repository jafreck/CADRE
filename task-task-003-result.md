# Task Result: task-003 - Wire PR info into IssueResult and handle null tokenUsage in IssueOrchestrator

## Changes Made
- `src/core/issue-orchestrator.ts`: Added `createdPR` instance field to store `PullRequestInfo` after successful PR creation
- `src/core/issue-orchestrator.ts`: Set `this.createdPR = pr` in `executePRComposition()` after `createPullRequest()` succeeds
- `src/core/issue-orchestrator.ts`: Updated `buildResult()` to include `pr: this.createdPR` in the returned `IssueResult`
- `src/core/issue-orchestrator.ts`: Changed `launchWithRetry()` fallback `tokenUsage` from `0` to `null`
- `src/core/issue-orchestrator.ts`: Updated `recordTokens()` parameter type from `number` to `number | null` and guard from `tokens > 0` to `tokens != null && tokens > 0`

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- TypeScript build passes with no new errors; pre-existing `github-issues.test.ts` failure is unrelated to these changes.
- The `createdPR` field is `undefined` when `autoCreate` is disabled or PR creation fails, which correctly matches the optional `pr?` field on `IssueResult`.
