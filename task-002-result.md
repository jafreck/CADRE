# Task Result: task-002 - Add `outputSchema` Field to `AgentContext` Interface

## Changes Made
- `src/agents/types.ts`: Added optional `outputSchema?: Record<string, unknown>` field to the `AgentContext` interface

## Files Modified
- src/agents/types.ts

## Files Created
- (none)

## Notes
- The field is optional so all existing `AgentContext` object constructions compile without change
- A pre-existing build error exists in `src/core/issue-orchestrator.ts` (unrelated to this task)
