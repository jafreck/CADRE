# CADRE Runner

## Role
Top-level reference agent describing the CADRE fleet execution model and runtime behavior.

## Overview

CADRE (Coordinated Agent Development Runtime Engine) is a multi-agent development framework that processes GitHub issues in parallel using git worktrees. This agent definition serves as a reference document for the runtime's fleet-level orchestration.

## Architecture

```
cadre run
  └── Fleet Orchestrator
       ├── Issue #1 Pipeline (worktree: .cadre/worktrees/issue-1/)
       │    ├── Phase 1: Analysis & Scouting
       │    ├── Phase 2: Planning
       │    ├── Phase 3: Implementation
       │    ├── Phase 4: Integration Verification
       │    └── Phase 5: PR Composition
       ├── Issue #2 Pipeline (worktree: .cadre/worktrees/issue-2/)
       │    └── ...
       └── Issue #N Pipeline
            └── ...
```

## Fleet Execution Model

1. **Issue Resolution**: Load issues from config (explicit IDs or query)
2. **Worktree Provisioning**: Create a git worktree per issue from the base branch
3. **Parallel Execution**: Run issue pipelines with bounded parallelism (`maxParallelIssues`)
4. **Checkpointing**: Save progress after each phase for resume capability
5. **Aggregation**: Collect results, report success/failure, cost estimates

## Configuration

CADRE is configured via `cadre.config.json`:

```json
{
  "projectName": "my-project",
  "repository": "owner/repo",
  "repoPath": ".",
  "baseBranch": "main",
  "issues": {
    "ids": [42, 43, 44]
  },
  "options": {
    "maxParallelIssues": 3,
    "maxParallelAgents": 2,
    "tokenBudget": 1000000,
    "resume": true
  },
  "commands": {
    "install": "npm install",
    "build": "npm run build",
    "test": "npm test"
  }
}
```

## CLI Commands

- `cadre run` — Execute the full pipeline
- `cadre status` — Show current progress
- `cadre reset` — Reset pipeline state
- `cadre worktrees` — List/prune managed worktrees

## Key Principles

1. **No AI in the runtime** — All intelligence lives in agent prompt files
2. **File-based IPC** — Agents communicate through files, not messages
3. **Worktree isolation** — Each issue works in its own worktree
4. **Deterministic pipeline** — Same inputs produce the same agent invocations
5. **Checkpoint/resume** — Every phase saves state for recovery
6. **Git operations are runtime's job** — Agents write files; runtime commits

## Constraints
- This is a reference document — the runtime (src/core/runtime.ts) handles execution
- Agents are invoked via Copilot CLI: `copilot --agent <name> -p "..." --allow-all-tools`
- Each agent reads a context JSON file and writes structured output
- The runtime never modifies agent prompt files at runtime
