# Test Result: task-005 - Create domain error classes in src/errors.ts

## Tests Written
- `tests/errors.test.ts`: 25 test cases (expanded from 4)
  - **BudgetExceededError** (6 tests)
    - instantiates with correct name, message, and properties
    - is an instance of BudgetExceededError
    - has a stack trace
    - handles zero values for current and budget
    - handles current equal to budget
    - can be caught as a generic Error
  - **PhaseFailedError** (5 tests)
    - instantiates with correct name, message, and properties
    - is an instance of PhaseFailedError
    - has a stack trace
    - handles phase 0
    - can be caught as a generic Error
  - **AgentTimeoutError** (6 tests)
    - instantiates with correct name, message, and properties
    - is an instance of AgentTimeoutError
    - has a stack trace
    - handles zero timeoutMs
    - handles empty agent string
    - can be caught as a generic Error
  - **SchemaValidationError** (8 tests)
    - instantiates with correct name, message, and properties
    - is an instance of SchemaValidationError
    - has a stack trace
    - accepts null as received
    - accepts undefined as received
    - accepts an object as received
    - accepts a string as received
    - can be caught as a generic Error

## Test Files Modified
- tests/errors.test.ts

## Test Files Created
- (none)

## Coverage Notes
- All four error classes are fully covered: happy path, `instanceof` hierarchy, stack trace presence, boundary values (zero, empty string, phase 0), and `received` accepting all `unknown` types (number, string, object, null, undefined).
- No external dependencies; no mocks required.
