# Test Result: task-009 - Integrate Validation into Runtime and CLI

## Tests Written
- `tests/runtime-validation.test.ts`: 12 new test cases
  - when skipValidation is not set (default):
    - should instantiate PreRunValidationSuite and call run()
    - should print formatted validation results to stdout
    - should call process.exit(1) when validation fails
    - should print ❌ Pre-run validation failed to stderr when validation fails
    - should not call process.exit(1) when validation passes
    - should pass with warnings when validation result has passed: true
  - when skipValidation is explicitly false:
    - should run validation
  - when skipValidation is true:
    - should skip PreRunValidationSuite instantiation
    - should not call suite.run()
    - should proceed without printing validation output
  - run() method signature:
    - should accept an optional skipValidation boolean parameter
    - should return a FleetResult

## Test Files Modified
- (none)

## Test Files Created
- tests/runtime-validation.test.ts

## Coverage Notes
- `cadre validate` CLI command not tested directly; commander-based CLI integration tests would require spawning a subprocess or a more complex CLI harness not present in the project. The underlying `PreRunValidationSuite` logic is already covered in `tests/validation-suite.test.ts`.
- `cadre run --skip-validation` flag wiring is indirectly covered: the test verifies `CadreRuntime.run(true)` skips validation, and the CLI simply passes `opts.skipValidation` to that method.
