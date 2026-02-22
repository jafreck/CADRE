# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update test assertion to match new `issue_read` MCP tool API
**File:** `tests/github-issues.test.ts`
**Issue:** Test expected `callTool('get_issue', { owner, repo, issue_number })` but source code uses `callTool('issue_read', { method: 'get', owner, repo, issue_number })`
**Fix:** Updated the `toHaveBeenCalledWith` assertion to use `'issue_read'` with `method: 'get'` to match the current source implementation in `src/github/api.ts`

## Files Modified
- tests/github-issues.test.ts

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests now pass
