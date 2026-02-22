# Task Result: task-004 - Register init Command in src/index.ts

## Changes Made
- `src/index.ts`: Imported `runInit` from `./cli/init.js` and added the `init` subcommand with `-y/--yes` and `--repo-path <path>` options, following the same pattern as existing commands.

## Files Modified
- src/index.ts

## Files Created
- (none)

## Notes
- The `init` command follows the same try/catch error-handling pattern as `run`, `status`, `reset`, and `worktrees`.
- `--yes` is coerced to a boolean via `!!opts.yes` to match `runInit`'s `{ yes: boolean }` signature.
