# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied
### Fix 1: Update outdated `get_issue` assertion to `issue_read` with method parameter
**File:** `tests/github-issues.test.ts`
**Issue:** The test asserted `callTool` was called with `'get_issue'` (old API), but the source code (`src/github/api.ts`) correctly uses `'issue_read'` with `{ method: 'get', ... }`.
**Fix:** Updated the `expect(mockMCP.callTool).toHaveBeenCalledWith(...)` assertion to use `'issue_read'` with `method: 'get'` to match the actual implementation.

## Files Modified
- `tests/github-issues.test.ts`

## Verification Notes
- Run `npx vitest run tests/github-issues.test.ts` — all 7 tests pass.
