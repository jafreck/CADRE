# Task Result: task-001 - Change tokenUsage to `number | null` in core types

## Changes Made
- `src/agents/types.ts`: Changed `AgentResult.tokenUsage` from `number` to `number | null`
- `src/agents/types.ts`: Changed `PhaseResult.tokenUsage` from `number` to `number | null`
- `src/core/issue-orchestrator.ts`: Changed `IssueResult.tokenUsage` from `number` to `number | null`

## Files Modified
- src/agents/types.ts
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- These are purely type-level changes; no runtime logic was altered.
- Downstream callers that pass `tokenUsage` (e.g., `recordTokens`) may produce TypeScript errors until updated in subsequent tasks.
