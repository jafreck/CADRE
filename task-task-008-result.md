# Task Result: task-008 - Refactor IssueOrchestrator to Use PhaseRegistry

## Changes Made
- `src/core/issue-orchestrator.ts`: Replaced switch/case dispatch in `executePhase()` with `PhaseRegistry` + `PhaseContext` delegation. Registered all five executor classes in constructor. Updated `run()` to iterate `registry.getAll()`. Removed five private phase methods, `executeTask()`, `tryFixIntegration()`, and `buildTaskPlanSlice()`. Updated imports accordingly.

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- `executePhase()` now accepts a `PhaseExecutor` instead of `PhaseDefinition`, builds a `PhaseContext` from the orchestrator's fields, and delegates to `executor.execute(ctx)`.
- `run()` uses `getPhase(executor.phaseId)` to look up `PhaseDefinition` for `critical` checks and `commitPhase()` calls.
- `launchWithRetry()` is retained on the orchestrator as per task instructions, though it is no longer called internally (executors have their own implementations).
- All 14 existing tests pass and `npm run build` succeeds.
