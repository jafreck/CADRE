# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied

### Fix 1: Add missing `estimateIssueTokens` mock to CostEstimator mock
**File:** `tests/fleet-orchestrator.test.ts`
**Issue:** The `CostEstimator` mock only included `estimate`, but `fleet-orchestrator.ts` calls `this.costEstimator.estimateIssueTokens()` in the pre-flight budget check, causing a `TypeError: this.costEstimator.estimateIssueTokens is not a function`.
**Fix:** Added `estimateIssueTokens: vi.fn().mockReturnValue(1000)` to the `CostEstimator` mock implementation. The return value of `1000` is intentionally below the test config's `tokenBudget: 100000` to ensure the pre-flight budget check passes and issue processing proceeds normally.

## Files Modified
- `tests/fleet-orchestrator.test.ts`

## Verification Notes
- Run `npx vitest run tests/fleet-orchestrator.test.ts` — all 6 tests pass.
