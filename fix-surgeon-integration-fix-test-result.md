# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update test assertion to match new `issue_read` MCP tool API
**File:** `tests/github-issues.test.ts`
**Issue:** Test expected `callTool('get_issue', {...})` but the implementation now calls `callTool('issue_read', { method: 'get', ... })`
**Fix:** Updated the `toHaveBeenCalledWith` assertion on line 48 to use `'issue_read'` with `method: 'get'` to match the actual implementation in `src/github/api.ts`

## Files Modified
- tests/github-issues.test.ts

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests pass
