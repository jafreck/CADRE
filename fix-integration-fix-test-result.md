# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update stale `get_issue` assertion to match `issue_read` MCP tool
**File:** `tests/github-issues.test.ts`
**Issue:** The test expected `mockMCP.callTool` to be called with `'get_issue'` and no `method` field, but the source code was updated to use `'issue_read'` with `method: 'get'` (matching the actual GitHub MCP server API).
**Fix:** Updated the `toHaveBeenCalledWith` assertion to expect `'issue_read'` with `method: 'get'`.

## Files Modified
- tests/github-issues.test.ts

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests pass.
