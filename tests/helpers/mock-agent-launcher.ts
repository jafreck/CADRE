import { writeFile } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import type { AgentInvocation, AgentResult, AgentName } from '../../src/agents/types.js';
import { ensureDir, exists } from '../../src/util/fs.js';

type HandlerFn = (invocation: AgentInvocation) => Partial<AgentResult> | Promise<Partial<AgentResult>>;

const SYNTHETIC_ANALYSIS = `# Analysis: Issue

## Requirements
- Implement the requested feature
- Ensure backward compatibility
- Add appropriate tests

**Change Type:** feature

**Scope:** medium

## Affected Areas
- src/core

## Ambiguities
- None identified
`;

const SYNTHETIC_SCOUT_REPORT = `# Scout Report

## Relevant Files
- \`src/core/issue-orchestrator.ts\` - Main orchestration logic
- \`src/agents/types.ts\` - Type definitions

## Test Files
- \`tests/issue-orchestrator.test.ts\`
`;

const SYNTHETIC_IMPLEMENTATION_PLAN = `# Implementation Plan: Issue

## Strategy
Implement the required changes incrementally.

## Task Summary
- **Total Tasks**: 2
- **Parallelizable Groups**: 1

## Tasks

### Task: task-001 - Implement core changes

**Description:** Make the primary code changes required by the issue.
**Files:** src/core/issue-orchestrator.ts
**Dependencies:** none
**Complexity:** moderate
**Acceptance Criteria:**
- Core changes implemented correctly
- Existing tests still pass

### Task: task-002 - Add tests

**Description:** Write tests for the changes made in task-001.
**Files:** tests/issue-orchestrator.test.ts
**Dependencies:** task-001
**Complexity:** simple
**Acceptance Criteria:**
- Tests cover the new functionality
- All tests pass
`;

const SYNTHETIC_REVIEW = `# Code Review

**Verdict:** pass

## Summary
The implementation looks correct and follows existing patterns. No issues found.
`;

const SYNTHETIC_PR_CONTENT = `---
title: "Implement requested changes"
labels: ["enhancement"]
---

## Summary

This PR implements the changes requested in the issue.

## Changes

- Core implementation complete
- Tests added
`;

/**
 * A mock implementation of AgentLauncher for use in tests.
 * Supports per-agent and per-task handler overrides, configurable failure,
 * and writes synthetic output files that satisfy CADRE's result parsers.
 */
export class MockAgentLauncher {
  private readonly handlers = new Map<AgentName, HandlerFn>();
  private readonly taskHandlers = new Map<string, HandlerFn>();
  private readonly failKeys = new Set<string>();

  /** Register a handler callback for all invocations of a given agent. */
  registerHandler(agent: AgentName, fn: HandlerFn): void {
    this.handlers.set(agent, fn);
  }

  /** Register a handler callback for a specific agent + task combination. */
  registerTaskHandler(agent: AgentName, taskId: string, fn: HandlerFn): void {
    this.taskHandlers.set(`${agent}:${taskId}`, fn);
  }

  /** Make the specified agent (optionally scoped to a task) return success: false. */
  failOn(agent: AgentName, taskId?: string): void {
    const key = taskId ? `${agent}:${taskId}` : agent;
    this.failKeys.add(key);
  }

  /** Launch a mock agent invocation. Mirrors AgentLauncher.launchAgent signature. */
  async launchAgent(invocation: AgentInvocation, _worktreePath: string): Promise<AgentResult> {
    const startTime = Date.now();

    const taskKey = invocation.taskId ? `${invocation.agent}:${invocation.taskId}` : null;
    const shouldFail =
      (taskKey !== null && this.failKeys.has(taskKey)) ||
      this.failKeys.has(invocation.agent);

    const handler = (taskKey !== null && this.taskHandlers.get(taskKey)) || this.handlers.get(invocation.agent);
    const partial = handler ? await handler(invocation) : {};

    if (!shouldFail) {
      await this.writeSyntheticOutput(invocation);
    }

    const outputExists = await exists(invocation.outputPath);
    const duration = Date.now() - startTime;

    return {
      agent: invocation.agent,
      success: !shouldFail,
      exitCode: !shouldFail ? 0 : 1,
      timedOut: false,
      duration,
      stdout: partial.stdout ?? '',
      stderr: shouldFail ? 'Mock failure' : (partial.stderr ?? ''),
      tokenUsage: partial.tokenUsage ?? 500,
      outputPath: invocation.outputPath,
      outputExists,
      error: shouldFail ? 'Mock failure' : partial.error,
    };
  }

  private async writeSyntheticOutput(invocation: AgentInvocation): Promise<void> {
    await ensureDir(dirname(invocation.outputPath));
    const content = this.syntheticContent(invocation);
    await writeFile(invocation.outputPath, content, 'utf-8');
  }

  private syntheticContent(invocation: AgentInvocation): string {
    const { agent } = invocation;
    const outFile = basename(invocation.outputPath);

    if (agent === 'issue-analyst' || outFile === 'analysis.md') {
      return SYNTHETIC_ANALYSIS;
    }
    if (agent === 'codebase-scout' || outFile === 'scout-report.md') {
      return SYNTHETIC_SCOUT_REPORT;
    }
    if (agent === 'implementation-planner' || outFile === 'implementation-plan.md') {
      return SYNTHETIC_IMPLEMENTATION_PLAN;
    }
    if (agent === 'pr-composer' || outFile === 'pr-content.md') {
      return SYNTHETIC_PR_CONTENT;
    }
    if (agent === 'code-reviewer' || outFile.startsWith('review')) {
      return SYNTHETIC_REVIEW;
    }

    return '# Output\n\nSynthetic output.\n';
  }
}
