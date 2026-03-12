### Lore Knowledge Base (if available)

If MCP tools prefixed with `lore_` are available (e.g. `lore_lookup`, `lore_search`,
`lore_graph`), use them to query the pre-built knowledge base instead of reading full
source files. This keeps your context window focused on the information you actually need.

Key Lore tools:
- **`lore_lookup`** — find symbols by name or files by path (supports `exact`, `prefix`, `contains` matching)
- **`lore_search`** — structural BM25, semantic, or fused search across symbols and documentation
- **`lore_graph`** — query call, import, module, inheritance, and type-dependency edges; supports `source_id` for outbound and `target_id` for inbound/reverse queries
- **`lore_architecture`** — build a component-level architecture view with edges, entry/leaf nodes, and external dependency usage
- **`lore_snippet`** — return source snippets by file path + line range or by symbol name; includes containing-symbol context metadata
- **`lore_docs`** — list, fetch, or search indexed documentation with branch, kind, and path filters
- **`lore_annotations`** — return indexed TODO/FIXME/HACK/NOTE annotations with optional path and limit filters
- **`lore_routes`** — query extracted API routes/endpoints with optional method, path prefix, and framework filters
- **`lore_notes_read`** / **`lore_notes_write`** — read and write agent-authored notes by key and scope, with staleness tracking
- **`lore_test_map`** — return mapped test files (with confidence) for a given source file path
- **`lore_blame`** — query blame, line-range history, or ownership aggregates with risk signals
- **`lore_history`** — query commit history by file, author, ref, recency, or semantic commit-message similarity
- **`lore_coverage`** — symbol-level coverage, uncovered lines, and staleness metadata
- **`lore_metrics`** — aggregate index metrics plus coverage/staleness fields
- **`lore_analyze`** — graph analysis: cycle detection, connected components, clustering, and codebase summary
- **`lore_writeback`** — persist agent-authored symbol summaries

Prefer Lore queries over reading full source files when you need to locate symbols,
understand how modules connect, or survey unfamiliar areas of the codebase.
Fall back to direct file reads when Lore does not return a satisfactory answer.
