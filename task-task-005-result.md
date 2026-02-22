# Task Result: task-005 - Create domain error classes in src/errors.ts

## Changes Made
- `src/errors.ts`: Created with four domain error classes: `BudgetExceededError`, `PhaseFailedError`, `AgentTimeoutError`, and `SchemaValidationError`
- `tests/errors.test.ts`: Created test file verifying each class instantiates with the correct `name`, `message`, and property values

## Files Modified
- (none)

## Files Created
- src/errors.ts
- tests/errors.test.ts

## Notes
- Each class extends `Error`, sets `this.name`, and carries the required contextual properties
- TypeScript build passes with no new errors
- All 4 tests pass
