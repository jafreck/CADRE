# Task Result: task-005 - Implement CommandValidator

## Changes Made
- `src/validation/command-validator.ts`: Created new `CommandValidator` class that checks each configured command's executable is on PATH using `which`

## Files Modified
- (none)

## Files Created
- src/validation/command-validator.ts

## Notes
- Iterates over `install`, `build`, `test`, `lint` from `config.commands`, skipping undefined entries
- Extracts the first word of each command string and runs `which <executable>` via `exec`
- Returns `passed: false` with an error message if any executable is not found; `passed: true` otherwise
- Validator `name` is `'commands'` as required
