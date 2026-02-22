# Task Result: task-004 - Register agents Command in src/index.ts

## Changes Made
- `src/index.ts`: Already contains `import { registerAgentsCommand } from './cli/agents.js'` and `registerAgentsCommand(program)` call — no changes needed.

## Files Modified
- (none)

## Files Created
- (none)

## Notes
- The implementation was already present in `src/index.ts` (lines 7 and 113). The import and registration of `registerAgentsCommand` were in place prior to this task running, likely applied as part of a prior step.
- All acceptance criteria are satisfied: `cadre agents --help` will show the `list`, `scaffold`, and `validate` subcommands registered in `src/cli/agents.ts`; existing commands (`run`, `status`, `reset`, `worktrees`) are unaffected; TypeScript compilation should succeed.
