# Task Result: task-006 - Extend Checkpoint Token Storage to Full TokenRecord[]

## Changes Made
- `src/core/checkpoint.ts`: Imported `TokenRecord` from `../budget/token-tracker.js`
- `src/core/checkpoint.ts`: Added `records: TokenRecord[]` field to `CheckpointState.tokenUsage`
- `src/core/checkpoint.ts`: Added `records: TokenRecord[]` field to `FleetCheckpointState.tokenUsage`
- `src/core/checkpoint.ts`: `createEmpty()` initializes `records: []`
- `src/core/checkpoint.ts`: `load()` defaults `tokenUsage.records` to `[]` for backward compatibility (both primary and backup paths)
- `src/core/checkpoint.ts`: `CheckpointManager.recordTokenUsage()` pushes a `TokenRecord` to `tokenUsage.records`
- `src/core/checkpoint.ts`: Added `CheckpointManager.getTokenRecords()` returning `TokenRecord[]`
- `src/core/checkpoint.ts`: `FleetCheckpointManager.load()` defaults `tokenUsage.records` to `[]` for backward compatibility
- `src/core/checkpoint.ts`: `FleetCheckpointManager` initializes new state with `records: []`
- `src/core/checkpoint.ts`: `FleetCheckpointManager.recordTokenUsage()` pushes a `TokenRecord` (using `agent: '__fleet__'`, `phase: 0`)

## Files Modified
- src/core/checkpoint.ts

## Files Created
- (none)

## Notes
- Existing callers of `recordTokenUsage` are unaffected (no signature changes).
- Pre-existing build error in `src/core/issue-orchestrator.ts:239` is unrelated to this task.
