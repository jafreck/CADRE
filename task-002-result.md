# Task Result: task-002 - Parse Structured cadre_tokens JSON in AgentLauncher

## Changes Made
- `src/core/agent-launcher.ts`: Imported `TokenUsageDetail` from `../agents/types.js`; updated `parseTokenUsage` return type from `number` to `TokenUsageDetail | number`; added structured JSON block detection for `{"cadre_tokens": {"input": N, "output": N, "model": "..."}}` before falling back to existing regex patterns

## Files Modified
- src/core/agent-launcher.ts

## Files Created
- (none)

## Notes
- The structured block is matched anywhere in combined stdout+stderr via regex, then JSON-parsed for the inner object.
- Falls back to existing regex patterns (returning a plain number) when no structured block is found.
- Returns `0` when neither is found (existing behavior preserved).
- The only build error (`src/core/issue-orchestrator.ts:239`) is pre-existing and unrelated to this task.
