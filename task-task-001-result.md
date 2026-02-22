# Task Result: task-001 - Fill in `cadre-runner.md` template

## Changes Made
- `src/agents/templates/cadre-runner.md`: Replaced 4-line stub with full 88-line system prompt describing the CADRE fleet execution model, all 5 pipeline phases and their agents, context file/output file conventions, worktree isolation, and runtime behavior.

## Files Modified
- src/agents/templates/cadre-runner.md

## Files Created
- (none)

## Notes
- File now has 88 lines, well above the 40-line minimum.
- Covers all 5 phases: Analysis & Scouting, Planning, Implementation, Integration Verification, PR Composition.
- Describes which agents participate in each phase and their roles.
- Explains the context file schema (agent, issueNumber, worktreePath, inputFiles, outputPath, payload) and output file conventions.
- All 21 `agent-templates.test.ts` tests pass.
