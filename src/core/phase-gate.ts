import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { GateResult, AgentSession } from '@cadre/agent-runtime';
import { extractCadreJson } from '@cadre/agent-runtime';
import {
  analysisSchema,
  scoutReportSchema,
  integrationReportSchema,
} from '../agents/schemas/index.js';
import { SessionQueue } from '../execution/task-queue.js';

// Re-export generic interfaces from engine
import type { PhaseGate, GateContext } from '../../packages/pipeline-engine/src/index.js';
export type { PhaseGate, GateContext };

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
      const parsed = extractCadreJson(analysisContent);
      if (parsed === null) {
        errors.push(
          'analysis.md is missing a cadre-json block; the issue-analyst agent must emit a ' +
          '```cadre-json``` fenced block containing a valid analysis object',
        );
      } else {
        const result = analysisSchema.safeParse(parsed);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push(
              `analysis.md cadre-json is invalid: ${issue.path.join('.') || 'root'} — ${issue.message}`,
            );
          }
        } else if (result.data.requirements.length === 0) {
          errors.push('analysis.md cadre-json: requirements array is empty');
        }
      }
    }

    // --- scout-report.md ---
    const scoutPath = join(context.progressDir, 'scout-report.md');
    const scoutContent = await readFileSafe(scoutPath);

    if (scoutContent === null) {
      errors.push('scout-report.md is missing from the progress directory');
    } else {
      const parsed = extractCadreJson(scoutContent);
      if (parsed === null) {
        errors.push(
          'scout-report.md is missing a cadre-json block; the codebase-scout agent must emit a ' +
          '```cadre-json``` fenced block containing a valid scout report',
        );
      } else {
        const result = scoutReportSchema.safeParse(parsed);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push(
              `scout-report.md cadre-json is invalid: ${issue.path.join('.') || 'root'} — ${issue.message}`,
            );
          }
        } else if (result.data.relevantFiles.length === 0) {
          errors.push(
            'scout-report.md cadre-json: relevantFiles array is empty; ' +
            'the codebase-scout agent must list at least one relevant file',
          );
        }
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
 * - Every session in `implementation-plan.md` has a rationale and at least one step.
 * - Every step has files, a description, and at least one acceptance criterion.
 * - The session dependency graph is acyclic (verified via SessionQueue).
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

    // Parse from cadre-json block
    const parsed = extractCadreJson(planContent);

    if (parsed === null) {
      return fail(['implementation-plan.md is missing a cadre-json block; the implementation-planner agent must emit a ```cadre-json``` fenced block containing a JSON array of session objects. See the agent template for the required schema.']);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fail(['implementation-plan.md cadre-json block contains no sessions']);
    }

    const sessions: AgentSession[] = [];

    for (let i = 0; i < (parsed as unknown[]).length; i++) {
      const s = (parsed as Record<string, unknown>[])[i];
      const id = String(s['id'] ?? `session-unknown-${i + 1}`);
      const name = String(s['name'] ?? id);
      const rationale = String(s['rationale'] ?? '');
      const dependencies = Array.isArray(s['dependencies']) ? (s['dependencies'] as string[]) : [];
      const rawSteps = Array.isArray(s['steps']) ? (s['steps'] as Record<string, unknown>[]) : [];

      if (!rationale) errors.push(`Session ${id} (${name}) is missing a rationale`);
      if (rawSteps.length === 0) errors.push(`Session ${id} (${name}) has no steps`);

      const steps = rawSteps.map((step, si) => {
        const stepId = String(step['id'] ?? `${id}-step-${si + 1}`);
        const stepName = String(step['name'] ?? stepId);
        const description = String(step['description'] ?? '');
        const files = Array.isArray(step['files']) ? (step['files'] as string[]) : [];
        const acceptanceCriteria = Array.isArray(step['acceptanceCriteria']) ? (step['acceptanceCriteria'] as string[]) : [];
        const complexity = (step['complexity'] as 'simple' | 'moderate' | 'complex') ?? 'moderate';

        if (!description) errors.push(`Session ${id}, Step ${stepId} (${stepName}) is missing a description`);
        if (files.length === 0) errors.push(`Session ${id}, Step ${stepId} (${stepName}) does not list any files`);
        if (acceptanceCriteria.length === 0) errors.push(`Session ${id}, Step ${stepId} (${stepName}) has no acceptance criteria`);

        return { id: stepId, name: stepName, description, files, complexity, acceptanceCriteria };
      });

      sessions.push({ id, name, rationale, dependencies, steps });
    }

    // Verify dependency DAG is acyclic
    try {
      new SessionQueue(sessions);
    } catch (err) {
      errors.push(`Implementation plan has a dependency cycle: ${String(err)}`);
    }

    // Check that each file referenced in the plan exists under the worktree
    for (const session of sessions) {
      for (const step of session.steps) {
        for (const filePath of step.files) {
          const resolvedPath = join(context.worktreePath, filePath);
          try {
            await access(resolvedPath);
          } catch {
            warnings.push(`Session ${session.id}, Step ${step.id}: file does not exist: ${filePath}`);
          }
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

    const parsed = extractCadreJson(reportContent);
    if (parsed === null) {
      return fail([
        'integration-report.md is missing a cadre-json block; the integration-checker agent must emit a ' +
        '```cadre-json``` fenced block containing a valid integration report',
      ]);
    }

    const schemaResult = integrationReportSchema.safeParse(parsed);
    if (!schemaResult.success) {
      return fail(
        schemaResult.error.issues.map(
          (i) =>
            `integration-report.md cadre-json is invalid: ${i.path.join('.') || 'root'} — ${i.message}`,
        ),
      );
    }

    const report = schemaResult.data;

    if (!report.buildResult.pass) {
      errors.push(
        `integration-report.md: build failed (exit code ${report.buildResult.exitCode})`,
      );
    }

    if (!report.testResult.pass) {
      errors.push(
        `integration-report.md: tests failed (exit code ${report.testResult.exitCode})`,
      );
    }

    if (report.regressionFailures && report.regressionFailures.length > 0) {
      errors.push('integration-report.md contains new regression failures');
    }

    if (report.baselineFailures && report.baselineFailures.length > 0) {
      warnings.push(
        'integration-report.md contains pre-existing failures (not caused by these changes)',
      );
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

