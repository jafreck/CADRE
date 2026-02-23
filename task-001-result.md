# Task Result: task-001 - Extend Token Type Interfaces

## Changes Made
- `src/agents/types.ts`: Added `TokenUsageDetail` interface with `input: number`, `output: number`, `model: string` fields; updated `AgentResult.tokenUsage` and `PhaseResult.tokenUsage` to `TokenUsageDetail | number | null`
- `src/budget/token-tracker.ts`: Added optional `input?: number` and `output?: number` fields to `TokenRecord`
- `src/core/issue-orchestrator.ts`: Updated `recordTokens` private method signature to accept `TokenUsageDetail | number | null` (extracts numeric total from `TokenUsageDetail` via `input + output`)

## Files Modified
- src/agents/types.ts
- src/budget/token-tracker.ts
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- The union type change is backward-compatible: existing callers assigning `number | null` continue to compile.
- A pre-existing build error in `src/core/issue-orchestrator.ts:239` (unrelated to this task) remains unchanged.
