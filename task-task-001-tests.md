# Test Result: task-001 - Change tokenUsage to `number | null` in core types

## Tests Written
- `tests/agent-types.test.ts`: 9 new test cases
  - AgentResult.tokenUsage: should accept null for tokenUsage
  - AgentResult.tokenUsage: should accept a number for tokenUsage
  - AgentResult.tokenUsage: should accept zero for tokenUsage
  - PhaseResult.tokenUsage: should accept null for tokenUsage
  - PhaseResult.tokenUsage: should accept a number for tokenUsage
  - PhaseResult.tokenUsage: should accept null with optional fields unset
  - IssueResult.tokenUsage: should accept null for tokenUsage
  - IssueResult.tokenUsage: should accept a number for tokenUsage
  - IssueResult.tokenUsage: should carry tokenUsage from phases

## Test Files Modified
- (none)

## Test Files Created
- tests/agent-types.test.ts

## Coverage Notes
- The changes are purely type-level; tests verify the runtime shape of `AgentResult`, `PhaseResult`, and `IssueResult` objects with `tokenUsage` set to both `null` and numeric values.
- `recordTokens` in `issue-orchestrator.ts` still has signature `tokens: number` (not `number | null`), which is a downstream concern noted in the task result as intentionally deferred.
