# Task Result: task-004 - Update ContextBuilder to Include outputSchema in Every Agent Context

## Changes Made
- `src/agents/context-builder.ts`: Added imports for `zodToJsonSchema` from `zod-to-json-schema` and all relevant schemas from `./schemas/index.js`. Added `outputSchema: zodToJsonSchema(...)` to all `buildFor*` methods whose agents have `hasStructuredOutput: true`.

## Files Modified
- src/agents/context-builder.ts

## Files Created
- (none)

## Notes
- `buildForIssueAnalyst` → uses `analysisSchema`
- `buildForCodebaseScout` → uses `scoutReportSchema`
- `buildForImplementationPlanner` → uses `implementationPlanSchema`
- `buildForAdjudicator` → uses `implementationPlanSchema` (adjudicator selects a plan)
- `buildForCodeReviewer` → uses `reviewSchema`
- `buildForIntegrationChecker` → uses `integrationReportSchema`
- `buildForPRComposer` → uses `prContentSchema`
- Agents without structured output (code-writer, test-writer, fix-surgeon) do not receive `outputSchema`
- A pre-existing build error in `src/core/issue-orchestrator.ts:238` (`Type 'number | null' is not assignable to type 'number'`) exists but is unrelated to this task
