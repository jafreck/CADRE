import { readFile } from 'node:fs/promises';
import type {
  ImplementationTask,
  AnalysisResult,
  ScoutReport,
  ReviewResult,
  IntegrationReport,
  PRContent,
} from './types.js';
import {
  analysisSchema,
  scoutReportSchema,
  implementationPlanSchema,
  reviewSchema,
  integrationReportSchema,
  prContentSchema,
} from './schemas/index.js';
/**
 * Parses structured output files produced by agents.
 */
export class ResultParser {
  constructor() {}

  /**
   * Extract and JSON-parse the first ```cadre-json``` fenced block in content.
   * Returns the parsed value, or null if no such block exists.
   */
  private extractCadreJson(content: string): unknown | null {
    const match = content.match(/```cadre-json\s*\n([\s\S]*?)```/);
    if (!match) return null;
    return JSON.parse(match[1].trim());
  }

  /**
   * Normalize a markdown string that may contain JSON-style escape sequences
   * (e.g. `\\n` → actual newline, `\\t` → actual tab).
   *
   * Agents that write cadre-json blocks sometimes double-escape newlines,
   * producing literal `\n` (two characters) instead of actual newline
   * characters. This results in comments/PR bodies displayed verbatim on
   * GitHub rather than rendered as Markdown.
   */
  private unescapeText(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '');
  }

  /**
   * Parse an implementation plan markdown into a list of ImplementationTasks.
   */
  async parseImplementationPlan(planPath: string): Promise<ImplementationTask[]> {
    const content = await readFile(planPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return implementationPlanSchema.parse(parsed);
    }

    throw new Error(
      `Agent output in ${planPath} is missing a \`cadre-json\` block. ` +
      'The implementation-planner agent must emit a ```cadre-json``` fenced block ' +
      'containing a JSON array of task objects. See the agent template for the required schema.',
    );
  }

  /**
   * Parse a code review result from review.md.
   */
  async parseReview(reviewPath: string): Promise<ReviewResult> {
    const content = await readFile(reviewPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = reviewSchema.parse(parsed);
      return {
        ...result,
        summary: this.unescapeText(result.summary),
        issues: result.issues.map((issue) => ({
          ...issue,
          description: this.unescapeText(issue.description),
        })),
      };
    }

    throw new Error(
      `Agent output in ${reviewPath} is missing a \`cadre-json\` block. ` +
      'The code-reviewer agent must emit a ```cadre-json``` fenced block containing a valid review object.',
    );
  }

  /**
   * Parse integration report from integration-report.md.
   */
  async parseIntegrationReport(reportPath: string): Promise<IntegrationReport> {
    const content = await readFile(reportPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return integrationReportSchema.parse(parsed);
    }

    throw new Error(
      `Agent output in ${reportPath} is missing a \`cadre-json\` block. ` +
      'The integration-checker agent must emit a ```cadre-json``` fenced block containing a valid integration report.',
    );
  }

  /**
   * Parse PR content from pr-content.md.
   */
  async parsePRContent(contentPath: string): Promise<PRContent> {
    const content = await readFile(contentPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = prContentSchema.parse(parsed);
      return { ...result, body: this.unescapeText(result.body) };
    }

    throw new Error(
      `Agent output in ${contentPath} is missing a \`cadre-json\` block. ` +
      'The PR-content agent must emit a ```cadre-json``` fenced block containing title, body, and labels.',
    );
  }

  /**
   * Parse a scout report from scout-report.md.
   */
  async parseScoutReport(reportPath: string): Promise<ScoutReport> {
    const content = await readFile(reportPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return scoutReportSchema.parse(parsed);
    }

    throw new Error(
      `Agent output in ${reportPath} is missing a \`cadre-json\` block. ` +
      'The codebase-scout agent must emit a ```cadre-json``` fenced block containing a valid scout report.',
    );
  }

  /**
   * Parse an analysis result from analysis.md.
   */
  async parseAnalysis(analysisPath: string): Promise<AnalysisResult> {
    const content = await readFile(analysisPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = analysisSchema.parse(parsed);
      return {
        ...result,
        requirements: result.requirements.map((s) => this.unescapeText(s)),
        affectedAreas: result.affectedAreas.map((s) => this.unescapeText(s)),
        ambiguities: result.ambiguities.map((s) => this.unescapeText(s)),
      };
    }

    throw new Error(
      `Agent output in ${analysisPath} is missing a \`cadre-json\` block. ` +
      'The issue-analyst agent must emit a ```cadre-json``` fenced block containing a valid analysis object.',
    );
  }
}
