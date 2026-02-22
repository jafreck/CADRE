# Test Result: task-002 - Implement Git Validator

## Tests Written

- `tests/git-validator.test.ts`: 11 test cases
  - should expose the name "git"
  - should return passed:false immediately (when .git absent)
  - should not call exec when .git is absent
  - should return passed:false when baseBranch does not exist locally
  - should return passed:true with no warnings when repo is clean and remote reachable
  - should return passed:true with warning when there are uncommitted changes
  - should return passed:true with warning when remote is unreachable
  - should return passed:true with warning when remote check times out
  - should include both uncommitted-changes and unreachable warnings together
  - should call rev-parse with the configured baseBranch
  - should check existence of .git inside repoPath

- `tests/agent-backend-validator.test.ts`: 8 test cases (already existed, kept unchanged)

## Test Files Modified
- (none)

## Test Files Created
- tests/git-validator.test.ts

## Coverage Notes
- All acceptance criteria from task-task-002.md are covered.
- `exec` and `exists` are mocked via `vi.mock` to keep tests deterministic.
- The timed-out branch (`lsRemote.timedOut === true`) is tested via a `timedOutResult` fixture.
