# Test Result: task-004 - Register init Command in src/index.ts

## Tests Written
- `tests/index-init.test.ts`: 11 new test cases
  - **command registration**
    - should list init in the top-level --help output
    - should show --yes option in init --help
    - should show --repo-path option in init --help
  - **action dispatch**
    - should call runInit with yes=false when --yes flag is not provided
    - should call runInit with yes=true when --yes flag is provided
    - should call runInit with yes=true when -y shorthand is provided
    - should call runInit with repoPath when --repo-path is provided
    - should call runInit with both yes=true and repoPath when both flags are provided
  - **error handling**
    - should print error in red and exit with code 1 when runInit throws
    - should handle non-Error throws and print their string representation
  - **existing commands unaffected**
    - should still list run, status, reset, and worktrees in --help

## Test Files Modified
- (none)

## Test Files Created
- tests/index-init.test.ts

## Coverage Notes
- Tests use `vi.resetModules()` + dynamic import to allow multiple re-imports of the entry point across tests.
- Async action timing is handled with `setTimeout(resolve, 0/10)` to let Commander's fire-and-forget async actions complete before asserting.
- Error handling tests override `process.exit` to not throw (returning `undefined as never`) so the async catch block can complete without causing unhandled rejections.
- The `chalk` wrapper around error messages is verified indirectly by checking that `console.error` was called with a string containing the error message text (chalk adds ANSI codes around the text).
