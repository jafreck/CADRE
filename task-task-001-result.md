# Task Result: task-001 - Add `issueUpdates` Config Schema

## Changes Made
- `src/config/schema.ts`: Added `issueUpdates` Zod object field to `CadreConfigSchema` with six boolean sub-fields (`enabled`, `onStart`, `onPhaseComplete`, `onComplete`, `onFailed`, `onBudgetWarning`) and their correct defaults. Used `.default({})` on the outer object for backward-compatible zero-config usage.

## Files Modified
- src/config/schema.ts

## Files Created
- (none)

## Notes
- All 17 existing tests in `tests/config-schema.test.ts` continue to pass with no modifications.
- A config object omitting `issueUpdates` passes schema validation and resolves to the defaults as required.
