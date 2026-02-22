# Test Result: task-006 - Implement Disk Space Validator

## Tests Written
- `tests/disk-validator.test.ts`: 19 test cases
  - should expose the name "disk"
  - when repoPath does not exist: should return passed:false with an error
  - when repoPath does not exist: should not call exec when repoPath is absent
  - when du -sk fails: should return passed:false with an error
  - when du output is unparseable: should return passed:false when du stdout has no numeric first field
  - when du output is unparseable: should return passed:false when du reports zero size
  - when df -k fails on worktreeRoot and repoPath: should return passed:false with an error
  - when df -k fails on worktreeRoot but succeeds on repoPath fallback: should return passed:true using the fallback df result when space is sufficient
  - when df output has unparseable available field: should return passed:false
  - disk space thresholds: should return passed:false when available < 1× estimate
  - disk space thresholds: should return passed:true with warning when available is between 1× and 2× estimate
  - disk space thresholds: should return passed:true with no warnings when available >= 2× estimate
  - disk space thresholds: should return passed:true with warning at exactly 2× estimate minus 1
  - maxParallelIssues default: should default maxParallelIssues to 3 when not configured
  - maxParallelIssues default: should use configured maxParallelIssues when set
  - df target path: should call df on worktreeRoot when configured
  - df target path: should call df on default worktreeRoot path when worktreeRoot is not configured
  - df target path: should call du on repoPath
  - df target path: should call statOrNull on repoPath

## Test Files Modified
- (none)

## Test Files Created
- tests/disk-validator.test.ts

## Coverage Notes
- The `formatKb` helper (KB/MB/GB formatting) is exercised indirectly through error/warning message content checks but not tested in isolation, since it is a private unexported function.
