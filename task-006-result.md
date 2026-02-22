# Task Result: task-006 - Implement Disk Space Validator

## Changes Made
- `src/validation/disk-validator.ts`: Created disk space validator that estimates required space as `repoSize × maxParallelIssues`, checks available space via `df -k`, and returns pass/warn/fail accordingly.

## Files Modified
- (none)

## Files Created
- src/validation/disk-validator.ts

## Notes
- Uses `exec` from `src/util/process.ts` to run `du -sk` (repo size) and `df -k` (available space).
- Uses `statOrNull` from `src/util/fs.ts` to verify `repoPath` exists before running `du`.
- Falls back to `config.repoPath` for `df` if `worktreeRoot` is not accessible.
- Returns `passed: false` when available < 1× estimate; warning when available < 2× estimate; `passed: true` with no warning when available ≥ 2× estimate.
