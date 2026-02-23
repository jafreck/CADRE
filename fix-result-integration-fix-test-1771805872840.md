# Fix Result: integration-fix-test

## Fix Type
test-failures

## Fixes Applied

### Fix 1: ResultParser acceptanceCriteria regex stops too early
**File:** `src/agents/result-parser.ts`
**Issue:** The acceptance criteria regex used `$` with the `m` flag, causing it to match end of each line so the lazy quantifier stopped after the first bullet item, returning only 1 criterion instead of 2.
**Fix:** Changed the regex to explicitly match bullet lines: `/^\*\*Acceptance Criteria:\*\*[ \t]*\n((?:[ \t]*[-*][ \t]+.+\n?)*)/m`

### Fix 2: CostEstimator mock missing estimateIssueTokens method
**File:** `tests/fleet-orchestrator.test.ts`
**Issue:** The `CostEstimator` mock only provided `estimate`, but `fleet-orchestrator.ts` calls `estimateIssueTokens()` during budget pre-flight checks, causing a TypeError that made all issues fail with `success: false`.
**Fix:** Added `estimateIssueTokens: vi.fn().mockReturnValue(10000)` to the `CostEstimator` vi.mock implementation.

## Files Modified
- `src/agents/result-parser.ts`
- `tests/fleet-orchestrator.test.ts`

## Verification Notes
- Run `npx vitest run tests/fleet-orchestrator.test.ts tests/result-parser.test.ts`
- All 16 tests pass (previously 4 failed)
