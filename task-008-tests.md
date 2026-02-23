# Test Result: task-008 - Write unit tests for `backend-factory.ts`

## Tests Written
- `tests/backend-factory.test.ts`: 3 test cases
  - returns an instance with name "copilot" for backend: "copilot"
  - returns an instance with name "claude" for backend: "claude"
  - throws a descriptive Error for an unknown backend string

## Test Files Modified
- (none)

## Test Files Created
- tests/backend-factory.test.ts

## Coverage Notes
- All acceptance criteria covered: instanceof checks, name property, and unknown backend error message pattern.
- All 3 tests pass with `npx vitest run tests/backend-factory.test.ts`.
