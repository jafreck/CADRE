# Issue Orchestrator

## Role
Reference document describing the per-issue 5-phase development pipeline that CADRE executes for each GitHub issue.

## Overview

This agent definition serves as a reference for the CADRE runtime's per-issue pipeline. The runtime (not this agent) orchestrates the execution of all phases. Each phase invokes specific agents in a defined order.

## Pipeline Phases

### Phase 1: Analysis & Scouting
**Agents:** `issue-analyst`, `codebase-scout`
**Goal:** Understand the issue and locate relevant code

1. Fetch issue details from GitHub
2. Launch `issue-analyst` → produces `analysis.md`
3. Launch `codebase-scout` → produces `scout-report.md`
4. These two agents can run in parallel
5. Commit: `chore(cadre): analyze issue #{number}`

### Phase 2: Planning
**Agents:** `implementation-planner`, `adjudicator` (optional)
**Goal:** Create a task-based implementation plan

1. Launch `implementation-planner` → produces `implementation-plan.md`
2. Parse plan to extract task list with dependencies
3. Validate: all referenced files exist, dependency graph is acyclic
4. Commit: `chore(cadre): plan implementation for #{number}`

### Phase 3: Implementation
**Agents:** `code-writer`, `test-writer`, `code-reviewer`, `fix-surgeon`
**Goal:** Implement all tasks with review and testing

For each ready task (dependencies satisfied):
1. Launch `code-writer` → modifies source files
2. Launch `test-writer` → writes test files
3. Launch `code-reviewer` → produces `review.md`
4. If review says "needs-fixes":
   a. Launch `fix-surgeon` with review feedback
   b. Re-run `code-reviewer` (up to maxRetries)
5. Commit: `feat(#{number}): implement {task-name}`

Tasks are executed in dependency order with parallelism where possible.

### Phase 4: Integration Verification
**Agents:** `integration-checker`, `fix-surgeon` (on failure)
**Goal:** Verify all changes integrate correctly

1. Run install, build, test, lint commands
2. If any fails, launch `fix-surgeon` with failure output
3. Re-attempt (up to 2 iterations)
4. Commit fixes: `fix(#{number}): address integration issues`

### Phase 5: PR Composition
**Agents:** `pr-composer`
**Goal:** Create a pull request

1. Generate full diff
2. Launch `pr-composer` → produces `pr-content.md`
3. Squash commits if configured
4. Push branch and create PR

## File Structure

Each issue's working data is stored under `.cadre/issues/{number}/`:

```
.cadre/issues/42/
├── issue.json              # Raw issue data
├── file-tree.txt           # Repository file listing
├── analysis.md             # Phase 1 output
├── scout-report.md         # Phase 1 output
├── implementation-plan.md  # Phase 2 output
├── tasks/
│   ├── task-001/
│   │   ├── context.json    # Agent input context
│   │   ├── result.md       # code-writer output
│   │   ├── tests.md        # test-writer output
│   │   └── review.md       # code-reviewer output
│   └── task-002/
│       └── ...
├── integration-report.md   # Phase 4 output
├── pr-content.md           # Phase 5 output
├── checkpoint.json         # Resume state
└── progress.md             # Human-readable progress
```

## Constraints
- This agent is a reference document — the runtime handles all orchestration
- Each phase's output becomes input for subsequent phases
- Phase failures in critical phases (1-3) abort the pipeline
- Phase failures in non-critical phases (4-5) are reported but don't block
