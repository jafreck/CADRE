# Test Result: task-006/task-007 - IntegrationPhaseExecutor & PRCompositionPhaseExecutor

## Tests Written

- `tests/integration-phase-executor.test.ts`: 25 test cases
  - **PhaseExecutor contract (3)**: phaseId = 4, name = 'Integration Verification', execute() exists
  - **execute() happy path (7)**: returns integration-report.md path, runs install/build/test/lint commands, writes report, no commit when clean, commits when dirty
  - **skip commands when not configured (4)**: skips install when unset, skips build/test when verification disabled, skips lint when unset
  - **fix-surgeon on build/test failure (7)**: launches fix-surgeon for build failure, for test failure, NOT for lint failure, writes failure file, records tokens, checks budget, includes fail status in report
  - **tryFixIntegration task construction (2)**: builds fix-surgeon context correctly, passes changed files from commitManager

- `tests/pr-composition-phase-executor.test.ts`: 27 test cases (already existed)

## Test Files Modified
- (none)

## Test Files Created
- tests/integration-phase-executor.test.ts

## Coverage Notes
- `tryFixIntegration` is tested indirectly via the `fix-surgeon` launch path — private method behavior is verified through observable side effects (writeFile, launchAgent, recordTokens calls)
- `execShell` is mocked via `vi.mock('../src/util/process.js')` to avoid actual subprocess spawning
- All 25 tests pass with `npx vitest run tests/integration-phase-executor.test.ts`
