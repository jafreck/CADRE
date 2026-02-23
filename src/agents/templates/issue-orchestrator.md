---
description: "Reference agent describing the per-issue 5-phase development pipeline."
tools: ["*"]
---
# Issue Orchestrator

## Role
Reference document describing the per-issue 5-phase development pipeline that CADRE executes for each GitHub issue.

## Overview

For each GitHub issue, CADRE runs a structured 5-phase pipeline. Each phase is handled by one or more specialized agents. The orchestrator coordinates handoffs between phases and ensures that outputs from one phase are available as inputs to the next.

---

## Phase 1: Analysis & Scouting

**Goal:** Understand the issue and locate the relevant code.

**Agents:**
- `issue-analyst`: Reads the GitHub issue, extracts requirements, classifies the change type, estimates scope, and identifies affected areas.
- `codebase-scout`: Scans the repository to locate the specific files relevant to the issue, maps their dependencies, and identifies related tests.

**Inputs:**
- GitHub issue number and body
- Repository source tree

**Outputs:**
- Issue analysis report (requirements, classification, scope estimate)
- Scout report (relevant files, dependency map, related tests)

---

## Phase 2: Planning

**Goal:** Produce a concrete, ordered implementation plan.

**Agents:**
- `implementation-planner`: Breaks the issue into discrete implementation tasks with dependencies, ordering, and acceptance criteria.
- `adjudicator` (optional): Evaluates competing implementation approaches and selects the best option.

**Inputs:**
- Issue analysis report (Phase 1)
- Scout report (Phase 1)

**Outputs:**
- Implementation plan (ordered task list with acceptance criteria and file assignments)

---

## Phase 3: Implementation

**Goal:** Write the code changes described in the plan.

**Agents:**
- `code-writer`: Implements each task from the plan by modifying or creating source files.
- `test-writer`: Writes unit and integration tests for the changes made by `code-writer`.
- `code-reviewer`: Reviews changes for correctness, style consistency, and potential issues.
- `fix-surgeon` (on failure): Applies targeted, minimal fixes to resolve issues identified during review or test runs.

**Inputs:**
- Implementation plan (Phase 2)
- Scout report (Phase 1)
- Source files identified in the plan

**Outputs:**
- Modified or created source files committed to the worktree
- New or updated test files
- Code review verdict (pass/fail with findings)

---

## Phase 4: Integration Verification

**Goal:** Confirm that all changes integrate correctly.

**Agents:**
- `integration-checker`: Runs build, test, and lint commands and reports the results.

**Inputs:**
- Modified worktree (Phase 3)
- Project build and test configuration

**Outputs:**
- Integration report (build status, test results, lint findings)
- Pass/fail verdict; failures trigger `fix-surgeon` loop back in Phase 3

---

## Phase 5: PR Composition

**Goal:** Produce a clear, informative pull request summarizing all changes.

**Agents:**
- `pr-composer`: Writes a pull request title and body summarizing all changes made to resolve the issue.

**Inputs:**
- GitHub issue (Phase 1)
- Implementation plan (Phase 2)
- List of commits and changed files (Phase 3 & 4)

**Outputs:**
- Pull request title and body ready for submission
