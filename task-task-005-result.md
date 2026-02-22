# Task Result: task-005 - Surface Gate Results in Per-Issue Progress Report

## Changes Made
- `src/core/progress.ts`: Added a "Gate Results" section to `IssueProgressWriter.write` that renders gate status (✅/⚠️/❌) and lists errors/warnings per phase when `gateResult` is present.

## Files Modified
- src/core/progress.ts

## Files Created
- (none)

## Notes
- Gate section only appears when at least one `PhaseResult` has a non-null `gateResult`.
- Errors are prefixed with ❌, warnings with ⚠️.
- TypeScript compiles without errors.
