import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { GateResult, ImplementationTask } from '../agents/types.js';
import { TaskQueue } from '../execution/task-queue.js';

/** Context passed to every gate validator. */
export interface GateContext {
  /** Directory containing agent output files (analysis.md, scout-report.md, etc.). */
  progressDir: string;
  /** Root path of the worktree. */
  worktreePath: string;
  /** Base commit SHA used to compute diff in ImplementationToIntegrationGate. */
  baseCommit?: string;
}

/** A quality gate that runs before transitioning between pipeline phases. */
export interface PhaseGate {
  validate(context: GateContext): Promise<GateResult>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function pass(warnings: string[] = []): GateResult {
  return { status: warnings.length > 0 ? 'warn' : 'pass', warnings, errors: [] };
}

function fail(errors: string[], warnings: string[] = []): GateResult {
  return { status: 'fail', warnings, errors };
}

// ── Gate 1→2: Analysis → Planning ────────────────────────────────────────────

/**
 * Validates that Phase 1 (Analysis & Scouting) produced complete output before
 * Phase 2 (Planning) begins.
 *
 * Checks:
 * - `analysis.md` has non-empty requirements, change type, and scope sections.
 * - `scout-report.md` lists at least one relevant file.
 */
export class AnalysisToPlanningGate implements PhaseGate {
  async validate(context: GateContext): Promise<GateResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // --- analysis.md ---
    const analysisPath = join(context.progressDir, 'analysis.md');
    const analysisContent = await readFileSafe(analysisPath);

    if (analysisContent === null) {
      errors.push('analysis.md is missing from the progress directory');
    } else {
      if (!/requirements?/i.test(analysisContent)) {
        errors.push('analysis.md does not contain a requirements section');
      } else if (analysisContent.match(/##\s*requirements?[^\n]*\n\s*\n/i)) {
        errors.push('analysis.md requirements section appears to be empty');
      }

      if (!/change.?type/i.test(analysisContent)) {
        errors.push('analysis.md does not specify a change type');
      }

      if (!/\bscope\b/i.test(analysisContent)) {
        errors.push('analysis.md does not specify a scope');
      }
    }

    // --- scout-report.md ---
    const scoutPath = join(context.progressDir, 'scout-report.md');
    const scoutContent = await readFileSafe(scoutPath);

    if (scoutContent === null) {
      errors.push('scout-report.md is missing from the progress directory');
    } else {
      // Expect at least one file path reference (heuristic: a line containing a '/')
      const hasRelevantFile = /[^\s]+\/[^\s]+/.test(scoutContent);
      if (!hasRelevantFile) {
        errors.push('scout-report.md does not list any relevant files');
      }
    }

    return errors.length > 0 ? fail(errors, warnings) : pass(warnings);
  }
}

// ── Gate 2→3: Planning → Implementation ──────────────────────────────────────

/**
 * Validates that Phase 2 (Planning) produced a well-formed implementation plan
 * before Phase 3 (Implementation) begins.
 *
 * Checks:
 * - Every task in `implementation-plan.md` has files, a description, and at
 *   least one acceptance criterion.
 * - The task dependency graph is acyclic (verified via TaskQueue).
 */
export class PlanningToImplementationGate implements PhaseGate {
  async validate(context: GateContext): Promise<GateResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const planPath = join(context.progressDir, 'implementation-plan.md');
    const planContent = await readFileSafe(planPath);

    if (planContent === null) {
      return fail(['implementation-plan.md is missing from the progress directory']);
    }

    // Heuristic parse: split on task headings
    const taskBlocks = planContent.split(/^#{2,3}\s+Task:\s+/m).slice(1);

    if (taskBlocks.length === 0) {
      return fail(['implementation-plan.md contains no tasks']);
    }

    const tasks: ImplementationTask[] = [];

    for (const block of taskBlocks) {
      const headerLine = block.split('\n')[0].trim();
      const headerMatch = headerLine.match(/^(task-\d+)\s*-\s*(.+)/);
      const id = headerMatch?.[1] ?? `task-unknown-${tasks.length + 1}`;
      const name = headerMatch?.[2]?.trim() ?? headerLine;

      const descMatch = block.match(/\*\*Description:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/s);
      const description = descMatch?.[1]?.trim() ?? '';

      const filesMatch = block.match(/\*\*Files:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/s);
      const filesStr = filesMatch?.[1]?.trim() ?? '';
      const files = filesStr
        .split(/[,\n]/)
        .map((f) => f.replace(/^[\s`*-]+|[\s`*]+$/g, '').trim())
        .filter(Boolean);

      const depsMatch = block.match(/\*\*Dependencies:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/s);
      const depsStr = depsMatch?.[1]?.trim() ?? 'none';
      const dependencies =
        depsStr.toLowerCase() === 'none'
          ? []
          : depsStr
              .split(/[,\n]/)
              .map((d) => d.replace(/^[\s`*-]+|[\s`*]+$/g, '').trim())
              .filter(Boolean);

      const criteriaMatch = block.match(/\*\*Acceptance Criteria:\*\*\s*([\s\S]*?)(?=\n\*\*|\n#{2,}|$)/);
      const criteriaStr = criteriaMatch?.[1]?.trim() ?? '';
      const acceptanceCriteria = criteriaStr
        .split('\n')
        .map((l) => l.replace(/^[\s*-]+/, '').trim())
        .filter(Boolean);

      // Validate this task
      if (!description) {
        errors.push(`Task ${id} (${name}) is missing a description`);
      }
      if (files.length === 0) {
        errors.push(`Task ${id} (${name}) does not list any files`);
      }
      if (acceptanceCriteria.length === 0) {
        errors.push(`Task ${id} (${name}) has no acceptance criteria`);
      }

      tasks.push({
        id,
        name,
        description,
        files,
        dependencies,
        complexity: 'moderate',
        acceptanceCriteria,
      });
    }

    // Verify dependency DAG is acyclic
    try {
      new TaskQueue(tasks);
    } catch (err) {
      errors.push(`Implementation plan has a dependency cycle: ${String(err)}`);
    }

    return errors.length > 0 ? fail(errors, warnings) : pass(warnings);
  }
}

// ── Gate 3→4: Implementation → Integration ───────────────────────────────────

/**
 * Validates that Phase 3 (Implementation) produced at least one file change
 * before Phase 4 (Integration Verification) begins.
 *
 * Checks:
 * - At least one file was modified (non-empty git diff).
 */
export class ImplementationToIntegrationGate implements PhaseGate {
  async validate(context: GateContext): Promise<GateResult> {
    try {
      const git = simpleGit(context.worktreePath);
      const diff = context.baseCommit
        ? await git.diff([`${context.baseCommit}..HEAD`])
        : await git.diff(['HEAD']);

      if (!diff || diff.trim().length === 0) {
        // Also check staged changes
        const stagedDiff = await git.diff(['--cached']);
        if (!stagedDiff || stagedDiff.trim().length === 0) {
          return fail(['No file changes detected; implementation phase produced no diff']);
        }
      }

      return pass();
    } catch (err) {
      const message = String(err);
      if (/not a git repository/i.test(message)) {
        // Working directory is not a git repository; cannot verify diff but allow gate to pass.
        return pass([`Could not verify file changes: working directory is not a git repository`]);
      }
      return fail([`Failed to compute git diff: ${message}`]);
    }
  }
}

// ── Gate 4→5: Integration → PR ───────────────────────────────────────────────

/**
 * Validates that Phase 4 (Integration Verification) produced a complete report
 * before Phase 5 (PR Composition) begins.
 *
 * Checks:
 * - `integration-report.md` exists.
 * - The report contains a build result section.
 * - The report contains a test result section.
 */
export class IntegrationToPRGate implements PhaseGate {
  async validate(context: GateContext): Promise<GateResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const reportPath = join(context.progressDir, 'integration-report.md');
    const reportContent = await readFileSafe(reportPath);

    if (reportContent === null) {
      return fail(['integration-report.md is missing from the progress directory']);
    }

    if (!/build/i.test(reportContent)) {
      errors.push('integration-report.md does not contain a build result section');
    }

    if (!/test/i.test(reportContent)) {
      errors.push('integration-report.md does not contain a test result section');
    }

    return errors.length > 0 ? fail(errors, warnings) : pass(warnings);
  }
}
