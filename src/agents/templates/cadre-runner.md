# CADRE Runner

## Role
Top-level reference agent describing the CADRE fleet execution model and runtime behavior.

## Overview

CADRE (Coordinated Autonomous Development with Reflexive Execution) is a multi-agent system that resolves GitHub issues by coordinating a fleet of specialized AI agents through a structured 5-phase pipeline. Each issue is processed in an isolated git worktree, and agents communicate through structured context files and output files written to disk.

## Architecture

The CADRE orchestrator receives a GitHub issue and spawns a per-issue pipeline. Each pipeline runs in a dedicated git worktree so multiple issues can be processed in parallel without interfering with each other. Agents are launched sequentially within each phase, with outputs from earlier phases feeding as inputs to later ones.

## Pipeline Phases

### Phase 1 — Analysis & Scouting (Critical)

This phase gathers information before any code is written.

- **issue-analyst**: Reads the GitHub issue body and extracts concrete requirements, classifies the change type (bug fix, feature, refactor, etc.), estimates scope, and identifies areas of the codebase likely to be affected.
- **codebase-scout**: Scans the repository to locate specific files relevant to the issue, maps their dependencies, and identifies related test files.

Failure in this phase aborts the pipeline.

### Phase 2 — Planning (Critical)

This phase produces a concrete implementation plan.

- **implementation-planner**: Consumes the issue analysis and scout report to break the issue into discrete, ordered implementation tasks with dependencies and acceptance criteria.
- **adjudicator**: Evaluates competing implementation plans or design decisions and selects the best option with clear reasoning.

Failure in this phase aborts the pipeline.

### Phase 3 — Implementation (Critical)

This phase executes the implementation plan task by task.

- **code-writer**: Implements a single task from the plan by modifying or creating source files in the worktree. Runs once per task.
- **test-writer**: Writes unit and integration tests for the changes made by the code-writer. Runs once per task.
- **code-reviewer**: Reviews the code and test changes for correctness, style consistency, and potential issues; returns a pass/fail verdict.
- **fix-surgeon**: Applies targeted, minimal fixes to resolve issues identified by the code-reviewer or failing tests. Runs when the reviewer returns a `needs-fixes` verdict.

Failure in this phase aborts the pipeline.

### Phase 4 — Integration Verification (Non-Critical)

This phase verifies the full set of changes works end-to-end.

- **integration-checker**: Runs the project's build, test, and lint commands in the worktree and reports whether all checks pass.

Failure in this phase is recorded but does not abort the pipeline.

### Phase 5 — PR Composition (Non-Critical)

This phase produces the pull request description.

- **pr-composer**: Writes a clear, informative pull request title and body summarizing all changes made across all tasks.

Failure in this phase is recorded but does not abort the pipeline.

## Context File Convention

Before launching each agent, the orchestrator writes a JSON **context file** to disk (typically under `.cadre/issues/<number>/contexts/`). The context file contains:

- `agent`: the agent name
- `issueNumber`, `projectName`, `repository`: issue and project metadata
- `worktreePath`: absolute path to the isolated git worktree for this issue
- `phase`: the current pipeline phase number
- `taskId`: an identifier for the specific task (used in Phase 3)
- `config.commands`: the project's install, build, test, and lint commands
- `inputFiles`: absolute paths to files the agent should read (prior phase outputs, implementation plan, scout report, etc.)
- `outputPath`: the path where the agent must write its result
- `payload`: agent-specific structured data (task description, acceptance criteria, etc.)

## Output File Convention

Each agent writes its result to the path specified in `outputPath`. Result files are Markdown documents summarizing what the agent did, what was found or changed, and any relevant structured data. Downstream agents receive these output files via their `inputFiles` list.

## Worktree Isolation

Every issue is processed in a separate git worktree checked out from the repository's main branch. Agents read and write only within their assigned `worktreePath`. At the end of a successful pipeline, CADRE commits the changes and opens a pull request from the worktree branch.

## Runtime Behavior

- Phases 1–3 are **critical**: any failure aborts the pipeline for that issue.
- Phases 4–5 are **non-critical**: failures are logged but the pipeline continues.
- Agents are stateless; all shared state is passed through context files and output files on disk.
- Token usage and cost are tracked per agent and reported in the final pipeline summary.
