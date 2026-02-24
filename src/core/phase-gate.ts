import { access, readFile } from 'node:fs/promises';
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

    // Primary: parse from cadre-json block
    const cadreJsonMatch = planContent.match(/```cadre-json\s*\n([\s\S]*?)```/);

    if (!cadreJsonMatch) {
      return fail(['implementation-plan.md is missing a cadre-json block; the implementation-planner agent must emit a ```cadre-json``` fenced block containing a JSON array of task objects']);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cadreJsonMatch[1].trim());
    } catch {
      return fail(['implementation-plan.md cadre-json block contains invalid JSON']);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fail(['implementation-plan.md cadre-json block contains no tasks']);
    }

    const tasks: ImplementationTask[] = [];

    for (let i = 0; i < (parsed as unknown[]).length; i++) {
      const t = (parsed as Record<string, unknown>[])[i];
      const id = String(t['id'] ?? `task-unknown-${i + 1}`);
      const name = String(t['name'] ?? id);
      const description = String(t['description'] ?? '');
      const files = Array.isArray(t['files']) ? (t['files'] as string[]) : [];
      const dependencies = Array.isArray(t['dependencies']) ? (t['dependencies'] as string[]) : [];
      const acceptanceCriteria = Array.isArray(t['acceptanceCriteria']) ? (t['acceptanceCriteria'] as string[]) : [];

      if (!description) errors.push(`Task ${id} (${name}) is missing a description`);
      if (files.length === 0) errors.push(`Task ${id} (${name}) does not list any files`);
      if (acceptanceCriteria.length === 0) errors.push(`Task ${id} (${name}) has no acceptance criteria`);

      tasks.push({ id, name, description, files, dependencies, complexity: 'moderate', acceptanceCriteria });
    }

    // Verify dependency DAG is acyclic
    try {
      new TaskQueue(tasks);
    } catch (err) {
      errors.push(`Implementation plan has a dependency cycle: ${String(err)}`);
    }

    // Check that each file referenced in the plan exists under the worktree
    for (const task of tasks) {
      for (const filePath of task.files) {
        const resolvedPath = join(context.worktreePath, filePath);
        try {
          await access(resolvedPath);
        } catch {
          warnings.push(`Task ${task.id}: file does not exist: ${filePath}`);
        }
      }
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
      return pass([`Could not verify git diff (non-git environment): ${String(err)}`]);
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
      warnings.push('integration-report.md does not contain a build result section');
    }

    if (!/test/i.test(reportContent)) {
      warnings.push('integration-report.md does not contain a test result section');
    }

    // Check for new regressions — only these should fail the gate
    const regressionsMatch = reportContent.match(/##\s*New Regressions\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (regressionsMatch) {
      const regressionsBody = regressionsMatch[1].trim();
      const hasRegressions = regressionsBody !== '' && !/^_none_$/i.test(regressionsBody);
      if (hasRegressions) {
        errors.push('integration-report.md contains new regression failures');
      }
    }

    // Warn (but do not fail) if there are pre-existing baseline failures
    const preExistingMatch = reportContent.match(/##\s*Pre-existing Failures\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (preExistingMatch) {
      const preExistingBody = preExistingMatch[1].trim();
      const hasPreExisting = preExistingBody !== '' && !/^_none_$/i.test(preExistingBody);
      if (hasPreExisting) {
        warnings.push('integration-report.md contains pre-existing failures (not caused by these changes)');
      }
    }

    return errors.length > 0 ? fail(errors, warnings) : pass(warnings);
  }
}

// ── Gate: Analysis Ambiguity Check ───────────────────────────────────────────

/**
 * Validates that the number of ambiguities identified in `analysis.md` does
 * not exceed a configured threshold before the pipeline proceeds.
 *
 * Checks:
 * - Extracts lines under the `## Ambiguities` heading in `analysis.md`.
 * - Returns `warn` when ambiguity count > 0 but ≤ threshold.
 * - Returns `fail` when count > threshold and `haltOnAmbiguity` is true.
 * - Returns `warn` when count > threshold but `haltOnAmbiguity` is false.
 * - Returns `pass` when there is no ambiguities section or it is empty.
 * - Warns (does not fail) when `analysis.md` is missing.
 */
export class AnalysisAmbiguityGate implements PhaseGate {
  private readonly ambiguityThreshold: number;
  private readonly haltOnAmbiguity: boolean;

  constructor(options?: { ambiguityThreshold?: number; haltOnAmbiguity?: boolean }) {
    this.ambiguityThreshold = options?.ambiguityThreshold ?? 5;
    this.haltOnAmbiguity = options?.haltOnAmbiguity ?? false;
  }

  async validate(context: GateContext): Promise<GateResult> {
    const analysisPath = join(context.progressDir, 'analysis.md');
    const analysisContent = await readFileSafe(analysisPath);

    if (analysisContent === null) {
      return pass(['analysis.md is missing; skipping ambiguity check']);
    }

    // Walk lines to extract the ## Ambiguities section
    const lines = analysisContent.split('\n');
    let inAmbiguities = false;
    const ambiguityLines: string[] = [];

    for (const line of lines) {
      if (/^##\s+Ambiguities/i.test(line)) {
        inAmbiguities = true;
        continue;
      }
      if (inAmbiguities && /^##\s/.test(line)) {
        break;
      }
      if (inAmbiguities && line.trim()) {
        ambiguityLines.push(line.trim());
      }
    }

    if (!inAmbiguities || ambiguityLines.length === 0) {
      return pass();
    }

    const count = ambiguityLines.length;
    const message = `${count} ambiguit${count === 1 ? 'y' : 'ies'} found in analysis.md (threshold: ${this.ambiguityThreshold})`;

    if (count > this.ambiguityThreshold && this.haltOnAmbiguity) {
      return fail([message]);
    }

    return pass([message]);
  }
}

