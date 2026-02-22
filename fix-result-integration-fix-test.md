# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update test assertion to match new `issue_read` MCP tool signature
**File:** `tests/github-issues.test.ts`
**Issue:** Test expected `callTool('get_issue', { owner, repo, issue_number })` but source now calls `callTool('issue_read', { method: 'get', owner, repo, issue_number })`
**Fix:** Updated `toHaveBeenCalledWith` assertion to use `'issue_read'` with `method: 'get'` to match the current implementation in `src/github/api.ts`

## Files Modified
- tests/github-issues.test.ts

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests now pass
