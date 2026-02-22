# Test Result: task-005 - Add Optional Pre-flight Agent Validation to cadre run

## Tests Written

### `tests/agent-launcher.test.ts`: 5 new test cases (in new `AgentLauncher.validateAgentFiles` describe block)
- should return empty array when all agent files exist and are non-empty
- should report missing files when agent files do not exist
- should report empty files
- should report multiple issues when several files are missing or empty
- should return empty array for an empty agent list directory that has all files

### `tests/cli-index.test.ts`: 1 new test case
- should register --skip-agent-validation option on the run command

## Test Files Modified
- tests/agent-launcher.test.ts
- tests/cli-index.test.ts

## Test Files Created
- (none)

## Coverage Notes
- The `validateAgentFiles` method is tested with a real temp directory (no mocking of `statOrNull`) to exercise the actual file-system checks end-to-end.
- The CLI flag test relies on updating the `buildProgram` helper in `cli-index.test.ts` to mirror the real `src/index.ts` `run` command options, since `src/index.ts` calls `program.parse()` at module level making it difficult to import directly.
- The runtime behavior of `--skip-agent-validation` (bypassing the validation block in the `action` handler) is not covered by a unit test, as it requires mocking `loadConfig`, `CadreRuntime`, and `process.exit`, which is out of scope for these focused unit tests.
