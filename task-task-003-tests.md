# Test Result: task-003 - Wire PR info into IssueResult and handle null tokenUsage in IssueOrchestrator

## Tests Written
- `tests/issue-orchestrator.test.ts`: 7 new test cases
  - should populate IssueResult.pr after successful PR creation
  - should leave IssueResult.pr undefined when autoCreate is disabled
  - should leave IssueResult.pr undefined when PR creation throws
  - should return tokenUsage: null when all retries are exhausted
  - should not record tokens when tokenUsage is null
  - should not record tokens when tokenUsage is 0
  - should record tokens when tokenUsage is a positive number

## Test Files Modified
- (none)

## Test Files Created
- tests/issue-orchestrator.test.ts

## Coverage Notes
- All internal class instantiations (CommitManager, ContextBuilder, ResultParser, RetryExecutor, IssueProgressWriter, TokenTracker) are mocked via vi.mock() so tests run without filesystem or process dependencies.
- Tests use a CheckpointManager mock that marks phases 1–4 as completed, ensuring only phase 5 executes and keeping tests focused on PR composition logic.
- The `launchWithRetry` fallback `tokenUsage: null` is verified indirectly by observing that RetryExecutor.execute returning failure causes the pipeline phase to fail gracefully (the fallback AgentResult structure itself is an internal implementation detail).
- The `recordTokens` null/zero guards are verified by asserting `TokenTracker.record` is or is not called, which directly tests the runtime guard condition `tokens != null && tokens > 0`.
