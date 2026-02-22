# Fix Result: task-002

## Fix Type
review-issues

## Fixes Applied

### Fix 1: Add `byPhase` to `FleetResult.tokenUsage`
**File:** `src/core/fleet-orchestrator.ts`
**Issue:** `FleetResult.tokenUsage` lacked a `byPhase` field, so `buildReport` used an intersection-type hack and `byPhase` was always `undefined` at runtime.
**Fix:** Added `byPhase: Record<number, number>` to the `tokenUsage` shape in `FleetResult`. `TokenTracker.getSummary()` already populates this field, so no changes to orchestrator logic were needed.

### Fix 2: Remove intersection-type hack from `buildReport` signature
**File:** `src/reporting/report-writer.ts`
**Issue:** `buildReport` accepted `FleetResult & { tokenUsage: { byPhase?: Record<number, number> } }` and used `?? {}` fallback because `byPhase` was never present.
**Fix:** Changed parameter type to plain `FleetResult` and removed the `?? {}` fallback since `byPhase` is now always present.

### Fix 3: Remove `agentInvocations` and `retries` from `RunReport`
**Files:** `src/reporting/types.ts`, `src/reporting/report-writer.ts`
**Issue:** `agentInvocations: 0` and `retries: 0` were hardcoded, emitting misleading data since these metrics are not tracked.
**Fix:** Removed both fields from the `RunReport` interface and from the `buildReport` return value.

### Fix 4: Add `byPhase` to empty result in `runtime.ts`
**File:** `src/core/runtime.ts`
**Issue:** `emptyResult()` constructed a `tokenUsage` object missing the now-required `byPhase` field, causing a TypeScript compile error.
**Fix:** Added `byPhase: {}` to the `tokenUsage` literal in `emptyResult()`.

### Fix 5: Update tests to reflect correct behavior
**File:** `tests/report-writer.test.ts`
**Issue:** Two tests verified the old buggy behavior (undefined byPhase fallback; agentInvocations/retries hardcoded to 0).
**Fix:** Updated `should handle result without byPhase (undefined)` → `should handle result with empty byPhase` (passes valid `byPhase: {}`), and updated `should set agentInvocations and retries to 0` → `should not include agentInvocations or retries fields`. Also cleaned up the `makeFleetResult` helper signature to use plain `FleetResult`.

## Files Modified
- `src/core/fleet-orchestrator.ts`
- `src/reporting/report-writer.ts`
- `src/reporting/types.ts`
- `src/core/runtime.ts`
- `tests/report-writer.test.ts`

## Verification Notes
- `npm run build` passes cleanly with no TypeScript errors.
- All 19 `report-writer.test.ts` tests pass.
- The pre-existing failure in `github-issues.test.ts` is unrelated and was present before these changes.
