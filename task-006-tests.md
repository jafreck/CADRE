# Test Result: task-006 - Extend Checkpoint Token Storage to Full TokenRecord[]

## Tests Written
- `tests/checkpoint.test.ts`: 15 new test cases added (8 for `CheckpointManager`, 6 for `FleetCheckpointManager`, plus 1 type fix)

### CheckpointManager
  - should initialize tokenUsage.records to [] on fresh checkpoint
  - should push a TokenRecord when recordTokenUsage is called
  - should accumulate multiple TokenRecords in order
  - getTokenRecords should return stored records
  - getTokenRecords should throw when checkpoint not loaded
  - should persist TokenRecords across save and reload
  - should default tokenUsage.records to [] when loading a legacy checkpoint without records field

### FleetCheckpointManager
  - should initialize fleet tokenUsage.records to []
  - should push a TokenRecord with __fleet__ agent when recordTokenUsage is called
  - should accumulate multiple fleet TokenRecords
  - should persist fleet TokenRecords across reload
  - should default fleet tokenUsage.records to [] when loading a legacy fleet checkpoint

## Test Files Modified
- tests/checkpoint.test.ts

## Test Files Created
- (none)

## Coverage Notes
- Backward-compatibility is tested by writing a raw JSON file that lacks the `records` field and verifying `load()` defaults it to `[]`.
- The existing `CheckpointState` type-only test was updated to include `records: []` to satisfy the now-required field.
