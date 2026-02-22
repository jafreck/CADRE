/**
 * Agent definitions registry for CADRE.
 */

import type { AgentName } from './types.js';

/** Metadata describing a CADRE agent. */
export interface AgentDefinition {
  name: AgentName;
  phase: number;
  phaseName: string;
  description: string;
  hasStructuredOutput: boolean;
  templateFile: string;
}

/** All known agent definitions, one per AgentName. */
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    name: 'issue-analyst',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Analyzes a GitHub issue to extract requirements, classify the change type, estimate scope, and identify affected areas.',
    hasStructuredOutput: false,
    templateFile: 'issue-analyst.agent.md',
  },
  {
    name: 'codebase-scout',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Scans the repository to locate relevant files, map dependencies, and identify related tests for a given issue.',
    hasStructuredOutput: false,
    templateFile: 'codebase-scout.agent.md',
  },
  {
    name: 'implementation-planner',
    phase: 2,
    phaseName: 'Planning',
    description: 'Breaks a GitHub issue into discrete implementation tasks with dependencies, ordering, and acceptance criteria.',
    hasStructuredOutput: false,
    templateFile: 'implementation-planner.agent.md',
  },
  {
    name: 'adjudicator',
    phase: 2,
    phaseName: 'Planning',
    description: 'Evaluates competing implementation plans or design decisions and selects the best option with clear reasoning.',
    hasStructuredOutput: false,
    templateFile: 'adjudicator.agent.md',
  },
  {
    name: 'code-writer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Implements a single task from the implementation plan by modifying or creating source files in the worktree.',
    hasStructuredOutput: false,
    templateFile: 'code-writer.agent.md',
  },
  {
    name: 'test-writer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Writes unit and integration tests for changes made by the code-writer, following the project\'s existing test patterns.',
    hasStructuredOutput: false,
    templateFile: 'test-writer.agent.md',
  },
  {
    name: 'code-reviewer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Reviews code changes for correctness, style consistency, and potential issues, providing a clear pass/fail verdict.',
    hasStructuredOutput: false,
    templateFile: 'code-reviewer.agent.md',
  },
  {
    name: 'fix-surgeon',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Applies targeted, minimal fixes to resolve specific issues identified by code review or failing tests.',
    hasStructuredOutput: false,
    templateFile: 'fix-surgeon.agent.md',
  },
  {
    name: 'integration-checker',
    phase: 4,
    phaseName: 'Integration Verification',
    description: 'Verifies that all changes integrate correctly by running build, test, and lint commands and reporting the results.',
    hasStructuredOutput: false,
    templateFile: 'integration-checker.agent.md',
  },
  {
    name: 'pr-composer',
    phase: 5,
    phaseName: 'PR Composition',
    description: 'Writes a clear, informative pull request title and body summarizing all changes made to resolve a GitHub issue.',
    hasStructuredOutput: false,
    templateFile: 'pr-composer.agent.md',
  },
  {
    name: 'issue-orchestrator',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Reference document describing the per-issue 5-phase development pipeline that CADRE executes for each GitHub issue.',
    hasStructuredOutput: false,
    templateFile: 'issue-orchestrator.agent.md',
  },
  {
    name: 'cadre-runner',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Top-level reference agent describing the CADRE fleet execution model and runtime behavior.',
    hasStructuredOutput: false,
    templateFile: 'cadre-runner.agent.md',
  },
] as const;
