# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update stale `get_issue` assertion to match new `issue_read` MCP tool
**File:** `tests/github-issues.test.ts`
**Issue:** Test expected `callTool` to be called with `'get_issue'` and `{ owner, repo, issue_number }`, but the source code now calls `'issue_read'` with `{ method: 'get', owner, repo, issue_number }`.
**Fix:** Updated the `toHaveBeenCalledWith` assertion to use `'issue_read'` and include `method: 'get'`.

## Files Modified
- tests/github-issues.test.ts

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests pass.
