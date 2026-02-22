# Task Result: task-006 - Tests for per-issue budget enforcement

## Changes Made
- `tests/issue-orchestrator.test.ts`: File already existed with complete test coverage (14 tests)

## Files Modified
- (none)

## Files Created
- (none)

## Notes
- The test file was already fully implemented and passing before this task ran
- All 14 tests pass with `npx vitest run tests/issue-orchestrator.test.ts`
- Coverage includes: BudgetExceededError class, IssueResult interface, success path (all phases completed), budget-exceeded abort with checkpoint persistence, resume guidance logging, re-throw of non-budget errors, and buildResult integration
- Tests use vi.fn() mocks to isolate IssueOrchestrator from real agent execution, filesystem, and network calls
