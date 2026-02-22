# Test Result: task-004 - Register init Command in src/index.ts

## Tests Written
- `tests/index-init.test.ts`: 7 new test cases
  - should call runInit with yes=false and no repoPath when no flags are passed
  - should call runInit with yes=true when --yes flag is passed
  - should call runInit with yes=true when -y short flag is passed
  - should call runInit with the provided --repo-path value
  - should call runInit with both --yes and --repo-path when both flags are provided
  - should print the error message and call process.exit(1) when runInit throws
  - should not call process.exit when runInit succeeds

## Test Files Modified
- (none)

## Test Files Created
- tests/index-init.test.ts

## Coverage Notes
- Tests use `vi.hoisted()` to create a stable mock instance for `runInit` that survives `vi.resetModules()` between tests, allowing the Commander program in `src/index.ts` to be re-imported fresh per test while sharing the same mock reference.
- Since `src/index.ts` calls `program.parse()` synchronously (not `parseAsync()`), action handlers run as floating promises; a `setTimeout(0)` settle step is used after each import to drain the microtask queue before asserting.
- The exact ANSI color codes from `chalk.red` are not asserted; `expect.stringContaining` is used to handle chalk's environment-aware color toggling.
