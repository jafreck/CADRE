# Fix Result: task-008

## Fix Type
review-issues

## Fixes Applied

### Fix 1: Call `recordDetailed()` when input/output split is available
**File:** `src/core/issue-orchestrator.ts`
**Issue:** `recordTokens` received a `TokenUsageDetail` but only called `this.tokenTracker.record()` with the total, discarding the input/output split. This caused `hasDetailedRecords` to always be `false` in `writeCostReport()`, meaning `estimateDetailed()` was never called.
**Fix:** Added a branch: when `tokens` is a `TokenUsageDetail` object, call `this.tokenTracker.recordDetailed()` to preserve the input/output split; otherwise use `record()` as before.

### Fix 2: Eliminate duplicate `TokenUsageDetail` interface
**File:** `src/budget/token-tracker.ts`
**Issue:** `TokenUsageDetail` was declared locally (without `model`) and also in `src/agents/types.ts` (with `model`), causing misleading duplication.
**Fix:** Removed the local `export interface TokenUsageDetail` definition and replaced it with `import type { TokenUsageDetail } from '../agents/types.js'` plus a re-export, so existing imports from `token-tracker.ts` continue to work.

## Files Modified
- `src/core/issue-orchestrator.ts`
- `src/budget/token-tracker.ts`

## Verification Notes
- Build succeeds (only pre-existing TS error at line 260 unrelated to these changes)
- Test suite: 848 passing, 34 failing (same 34 pre-existing failures; no regressions)
- `writeCostReport()` will now detect `input`/`output` on records and use `estimateDetailed()` when available
