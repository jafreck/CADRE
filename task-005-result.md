# Task Result: task-005 - Add `cadre report` CLI Command

## Changes Made
- `src/index.ts`: Added `cadre report` command with `--format <format>` and `--history` options, following the same pattern as `status` and `reset`. The action handler loads config, creates a `CadreRuntime`, and calls `runtime.report({ format: opts.format, history: opts.history })`.

## Files Modified
- src/index.ts

## Files Created
- (none)

## Notes
- Default format is `'human'`; passing `--format json` sets it to `'json'`
- `--history` is a boolean flag (defaults to `false` when omitted)
- File compiles cleanly with `npm run build`
