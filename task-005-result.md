# Task Result: task-005 - Add postCostComment Option to Config Schema

## Changes Made
- `src/config/schema.ts`: Added `postCostComment: z.boolean().default(false)` to the `options` object in `CadreConfigSchema`.

## Files Modified
- src/config/schema.ts

## Files Created
- (none)

## Notes
- The field is added with `default(false)`, so existing config files that omit `postCostComment` will continue to parse successfully.
- `CadreConfig['options']['postCostComment']` resolves to `boolean` in TypeScript via Zod inference.
