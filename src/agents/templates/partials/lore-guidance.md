### Lore Knowledge Base (if available)

If the `mcp__lore` tool is available, use it to query the pre-built knowledge base for function signatures, type definitions, module exports, dependency relationships, and architecture patterns. Prefer Lore queries over reading full source files when you need to locate symbols, understand how modules connect, or survey unfamiliar areas of the codebase. This keeps your context window focused on the information you actually need.

Fall back to direct file reads when Lore does not return a satisfactory answer.
