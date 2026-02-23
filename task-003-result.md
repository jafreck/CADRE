# Task Result: task-003 - Update TokenTracker to Record Detailed Splits

## Changes Made
- `src/budget/token-tracker.ts`: Added `TokenUsageDetail` interface with `input` and `output` fields
- `src/budget/token-tracker.ts`: Added `recordDetailed(issueNumber, agent, phase, detail: TokenUsageDetail): void` method that stores `input`, `output`, and `tokens = input + output`
- `src/budget/token-tracker.ts`: Added `getRecords(): TokenRecord[]` method as an alias for `exportRecords()`

## Files Modified
- src/budget/token-tracker.ts

## Files Created
- (none)

## Notes
- `TokenRecord` already had optional `input?` and `output?` fields, so `importRecords()` and `exportRecords()` already support them without changes
- All existing `getTotal()`, `getByAgent()`, `getByPhase()` methods continue to aggregate via `record.tokens`
- All 16 token-tracker tests pass
