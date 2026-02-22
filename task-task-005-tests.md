# Test Result: task-005 - Surface Gate Results in Per-Issue Progress Report

## Tests Written
- `tests/progress.test.ts`: 10 new test cases
  - should NOT include a Gate Results section when no phases have gateResult
  - should include a Gate Results section when a phase has gateResult
  - should render ✅ emoji for a passing gate
  - should render ⚠️ emoji for a warning gate
  - should render ❌ emoji for a failing gate
  - should list errors prefixed with ❌ under the phase
  - should list warnings prefixed with ⚠️ under the phase
  - should render gate results for multiple phases
  - should render both errors and warnings in the same phase section
  - should omit Gate Results section for phases without gateResult even when other phases have it

## Test Files Modified
- (none)

## Test Files Created
- tests/progress.test.ts

## Coverage Notes
- All tests run against a real tmpdir using vitest, reading the generated `progress.md` file.
- Tests focus on the new Gate Results section; existing Phases table and task-list rendering are not re-tested here as they predate task-005.
