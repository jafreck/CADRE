import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GateResult, PhaseResult } from '../agents/types.js';
import { AnalysisAmbiguityGate, type GateContext } from './phase-gate.js';
import { buildGateMap } from './phase-registry.js';
import type { CheckpointManager } from './checkpoint.js';
import type { IssueProgressWriter } from './progress.js';
import type { Logger } from '../logging/logger.js';
import { extractCadreJson } from '../util/cadre-json.js';

/** Stateless gates — constructed once and reused across all runGate() calls. */
const GATE_MAP = buildGateMap();

export interface GateCoordinatorOptions {
  ambiguityThreshold: number;
  haltOnAmbiguity: boolean;
}

/**
 * Encapsulates gate validation, ambiguity gate merging, and gate result recording.
 */
export class GateCoordinator {
  constructor(
    private readonly checkpoint: CheckpointManager,
    private readonly progressWriter: IssueProgressWriter,
    private readonly logger: Logger,
    private readonly options: GateCoordinatorOptions,
    private readonly progressDir: string,
    private readonly worktreePath: string,
    private readonly baseCommit: string | undefined,
    private readonly issueNumber: number,
  ) {}

  /**
   * Run the gate for a given phase, merge ambiguity gate for phase 1,
   * record the result on the checkpoint, and update the last entry of phases.
   */
  async runGate(phaseId: number, phases: PhaseResult[]): Promise<'pass' | 'warn' | 'fail'> {
    const gate = GATE_MAP[phaseId];
    if (!gate) return 'pass';

    const context: GateContext = {
      progressDir: this.progressDir,
      worktreePath: this.worktreePath,
      baseCommit: this.baseCommit,
    };

    let result = await gate.validate(context);

    // For phase 1, also run the ambiguity gate and merge results
    if (phaseId === 1) {
      const ambiguityGate = new AnalysisAmbiguityGate({
        ambiguityThreshold: this.options.ambiguityThreshold,
        haltOnAmbiguity: this.options.haltOnAmbiguity,
      });
      const ambiguityResult = await ambiguityGate.validate(context);
      const mergedErrors = [...result.errors, ...ambiguityResult.errors];
      const mergedWarnings = [...result.warnings, ...ambiguityResult.warnings];
      const mergedStatus = mergedErrors.length > 0 ? 'fail' : mergedWarnings.length > 0 ? 'warn' : 'pass';
      result = { status: mergedStatus, errors: mergedErrors, warnings: mergedWarnings };
    }

    await this.checkpoint.recordGateResult(phaseId, result);

    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      gateResult: result,
    };

    if (result.status === 'warn') {
      for (const w of result.warnings) {
        this.logger.warn(`Gate phase ${phaseId}: ${w}`, { issueNumber: this.issueNumber, phase: phaseId });
      }
      await this.progressWriter.appendEvent(
        `Gate phase ${phaseId}: passed with ${result.warnings.length} warning(s)`,
      );
    } else if (result.status === 'fail') {
      for (const e of result.errors) {
        this.logger.error(`Gate phase ${phaseId}: ${e}`, { issueNumber: this.issueNumber, phase: phaseId });
      }
      await this.progressWriter.appendEvent(`Gate phase ${phaseId} failed: ${result.errors.join('; ')}`);
    } else {
      await this.progressWriter.appendEvent(`Gate phase ${phaseId}: passed`);
    }

    return result.status;
  }

  /**
   * Read ambiguities from analysis.md via extractCadreJson.
   */
  async readAmbiguities(): Promise<string[]> {
    const analysisPath = join(this.progressDir, 'analysis.md');
    let content: string;
    try {
      content = await readFile(analysisPath, 'utf-8');
    } catch {
      return [];
    }

    const data = extractCadreJson(content) as Record<string, unknown> | null;
    if (data === null) {
      this.logger.warn(
        `analysis.md for issue #${this.issueNumber} has no cadre-json block; ambiguities will not be reported`,
        { issueNumber: this.issueNumber },
      );
      return [];
    }

    try {
      const ambiguities = data['ambiguities'];
      if (Array.isArray(ambiguities)) {
        return ambiguities.filter((a): a is string => typeof a === 'string');
      }
      return [];
    } catch (err) {
      this.logger.warn(
        `Failed to parse cadre-json block in analysis.md for issue #${this.issueNumber}: ${err}`,
        { issueNumber: this.issueNumber },
      );
      return [];
    }
  }
}
