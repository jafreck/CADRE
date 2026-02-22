# Task Result: task-004 - Register init Command in src/index.ts

## Changes Made
- `src/index.ts`: Imported `runInit` from `./cli/init.js` and registered the `init` subcommand with `--yes` / `-y` and `--repo-path` options, following the same pattern as existing commands

## Files Modified
- src/index.ts

## Files Created
- (none)

## Notes
- The `init` command follows identical style to `run`, `status`, `reset`, and `worktrees` commands: comment header, `.command()`, `.description()`, `.option()`, `.action()` with try/catch using `chalk.red` and `process.exit(1)`
- Build verified successfully with `npm run build`
