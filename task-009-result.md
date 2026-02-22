# Task Result: task-009 - Integrate Validation into CadreRuntime and CLI

## Changes Made
- `src/config/schema.ts`: Added `skipValidation: z.boolean().default(false)` to the `options` schema object.
- `src/config/loader.ts`: Added `skipValidation` to the `applyOverrides` overrides parameter type and applied it to `merged.options`.
- `src/core/runtime.ts`: Imported all five validators and `PreRunValidationSuite` from `../validation/index.js`. Added `validate()` method that constructs the suite with all five validators and runs it. Updated `run()` to call `validate()` at the top (before shutdown handler setup) unless `config.options.skipValidation` is true; throws an error with a descriptive message if validation fails.
- `src/index.ts`: Added `--skip-validation` option to the `run` command, passed via `applyOverrides`. Added new `cadre validate` subcommand that loads config, instantiates the runtime, calls `validate()`, and exits 0 on success or 1 on any errors.

## Files Modified
- src/config/schema.ts
- src/config/loader.ts
- src/core/runtime.ts
- src/index.ts

## Files Created
- (none)

## Notes
- `cadre validate` exits 0 for warnings (only errors cause exit 1), matching the acceptance criterion.
- `cadre run` throws before the fleet starts if validation fails and `--skip-validation` is not set.
- The pre-existing `github-issues.test.ts` failure is unrelated to this task.
