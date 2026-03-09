### Lore Knowledge Base (if available)

If MCP tools prefixed with `lore_` are available (e.g. `lore_lookup`, `lore_search`,
`lore_graph`), use them to query the pre-built knowledge base instead of reading full
source files. This keeps your context window focused on the information you actually need.

Key Lore tools:
- **`lore_lookup`** — find symbols by name or files by path (supports `exact`, `prefix`, `contains` matching)
- **`lore_search`** — structural BM25, semantic, or fused search across symbols and documentation
- **`lore_graph`** — query call, import, module, inheritance, and type-dependency edges
- **`lore_architecture`** — build a component-level architecture view with edges and entry/leaf nodes
- **`lore_snippet`** — return source snippets by file path + line range or by symbol name
- **`lore_docs`** — list, fetch, or search indexed documentation

Prefer Lore queries over reading full source files when you need to locate symbols,
understand how modules connect, or survey unfamiliar areas of the codebase.
Fall back to direct file reads when Lore does not return a satisfactory answer.
