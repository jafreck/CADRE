# Task Result: task-009 - Integrate Validation into Runtime and CLI

## Changes Made
- `src/core/runtime.ts`: Imported `PreRunValidationSuite`; modified `run()` to accept optional `skipValidation?: boolean` parameter; added validation block at the top of `run()` that runs the suite, prints formatted results, and calls `process.exit(1)` with `❌ Pre-run validation failed` when validation fails.
- `src/index.ts`: Imported `PreRunValidationSuite`; added `--skip-validation` flag to `cadre run` command, passing `opts.skipValidation` to `runtime.run()`; added new `cadre validate` command that loads config, runs the validation suite, prints formatted results, and exits 0 (pass) or 1 (fail).

## Files Modified
- src/core/runtime.ts
- src/index.ts

## Files Created
- (none)

## Notes
- `CadreRuntime.run()` now accepts `skipValidation?: boolean`; when falsy (default), validation runs before any pipeline work.
- The `cadre validate` command is standalone and does not require a running runtime instance.
