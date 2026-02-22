# Task Result: task-004 - Wire Gate Validators into IssueOrchestrator

## Changes Made
- `src/core/issue-orchestrator.ts`: Imported `AnalysisToPlanningGate`, `PlanningToImplementationGate`, `ImplementationToIntegrationGate`, `IntegrationToPRGate`, `GateContext`, and `PhaseGate` from `./phase-gate.js`.
- `src/core/issue-orchestrator.ts`: Added `runGate(phaseId)` private method that instantiates the appropriate gate validator, runs it, records the result via `checkpoint.recordGateResult`, logs warnings/errors, and appends a gate event to the progress writer.
- `src/core/issue-orchestrator.ts`: Modified the `run()` loop success block to call `runGate` after phases 1–4; on `fail`, retries the phase once — if gate still fails after retry, the pipeline aborts with a descriptive error; `warn` results are logged but do not block the pipeline.

## Files Modified
- src/core/issue-orchestrator.ts

## Files Created
- (none)

## Notes
- Gate validators run automatically after each of phases 1, 2, 3, and 4.
- `warn` gate results log all warnings and continue the pipeline normally.
- `fail` gate results trigger at most one retry of the failed phase; if the gate still fails after the retry, `buildResult(false, ...)` is returned, effectively aborting and marking the issue blocked.
- Gate results are persisted via `checkpoint.recordGateResult(phaseId, result)`.
- Gate events (pass, warn, fail, retry, abort) are appended to the progress writer.
- TypeScript compiles without errors (`npm run build` exits 0).
