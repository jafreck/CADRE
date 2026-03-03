/**
 * Progress writers for per-issue and fleet-level pipeline progress tracking.
 */

import { join } from 'node:path';
import { atomicWriteFile, ensureDir } from '../util/fs.js';
import type { Logger, PhaseResult } from '../types.js';

export const phaseNames = [
  'Analysis & Scouting',
  'Planning',
  'Implementation',
  'Integration Verification',
  'PR Composition',
] as const;

export interface PullRequestRef {
  issueNumber: number;
  prNumber: number;
  url: string;
}

export interface IssueProgressInfo {
  issueNumber: number;
  issueTitle: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'failed' | 'blocked' | 'budget-exceeded' | 'code-complete' | 'dep-failed' | 'dep-merge-conflict' | 'dep-build-broken' | 'dep-blocked';
  currentPhase: number;
  totalPhases: number;
  prNumber?: number;
  branch?: string;
  error?: string;
}

/**
 * Writes fleet-level progress.md in the .cadre directory.
 */
export class FleetProgressWriter {
  private readonly progressPath: string;
  private events: string[] = [];

  constructor(
    private readonly cadreDir: string,
    private readonly logger: Logger,
  ) {
    this.progressPath = join(cadreDir, 'progress.md');
  }

  /**
   * Write or update the fleet progress file.
   */
  async write(
    issues: IssueProgressInfo[],
    prs: PullRequestRef[],
    tokenUsage: { current: number; budget?: number },
  ): Promise<void> {
    await ensureDir(this.cadreDir);

    const total = issues.length;
    const completed = issues.filter((i) => i.status === 'completed').length;
    const inProgress = issues.filter((i) => i.status === 'in-progress').length;
    const failed = issues.filter((i) => i.status === 'failed').length;
    const blocked = issues.filter((i) => i.status === 'blocked').length;
    const notStarted = issues.filter((i) => i.status === 'not-started').length;
    const budgetExceeded = issues.filter((i) => i.status === 'budget-exceeded').length;

    const budgetStr = tokenUsage.budget
      ? `${tokenUsage.current.toLocaleString()} / ${tokenUsage.budget.toLocaleString()}`
      : tokenUsage.current.toLocaleString();

    let md = `# CADRE Progress\n\n`;
    md += `## Fleet Status\n`;
    md += `- **Issues**: ${total} total | ${completed} completed | ${inProgress} in-progress | ${failed} failed | ${blocked} blocked | ${notStarted} not-started | ${budgetExceeded} budget-exceeded\n`;
    md += `- **PRs Created**: ${prs.length}\n`;
    md += `- **Token Usage**: ${budgetStr}\n`;
    md += `- **Last Updated**: ${new Date().toISOString()}\n\n`;

    md += `## Issues\n\n`;
    md += `| Issue | Title | Status | Phase | PR |\n`;
    md += `|-------|-------|--------|-------|----|`;

    for (const issue of issues) {
      const prLink = issue.prNumber ? `#${issue.prNumber}` : '—';
      const statusEmoji = {
        'not-started': '⏳',
        'in-progress': '🔄',
        completed: '✅',
        failed: '❌',
        blocked: '🚫',
        'budget-exceeded': '💸',
        'code-complete': '⚠️',
        'dep-failed': '❌',
        'dep-merge-conflict': '⚠️',
        'dep-build-broken': '❌',
        'dep-blocked': '🚫',
      }[issue.status];
      md += `\n| #${issue.issueNumber} | ${issue.issueTitle} | ${statusEmoji} ${issue.status} | ${issue.currentPhase}/${issue.totalPhases} | ${prLink} |`;
    }

    const codeCompleteIssues = issues.filter((i) => i.status === 'code-complete');
    if (codeCompleteIssues.length > 0) {
      md += `\n\n## Code Complete — PR Needed\n\n`;
      for (const issue of codeCompleteIssues) {
        md += `- #${issue.issueNumber} ${issue.issueTitle} — branch: \`${issue.branch ?? 'unknown'}\`\n`;
      }
    }

    if (this.events.length > 0) {
      md += `\n\n## Event Log\n\n`;
      for (const event of this.events.slice(-20)) {
        md += `- ${event}\n`;
      }
    }

    md += '\n';

    await atomicWriteFile(this.progressPath, md);
  }

  /**
   * Append an event to the progress log.
   */
  async appendEvent(event: string): Promise<void> {
    const ts = new Date().toISOString().slice(11, 19);
    this.events.push(`\`${ts}\` ${event}`);
  }
}

/**
 * Writes per-issue progress.md within the issue's progress directory.
 */
export class IssueProgressWriter {
  private readonly progressPath: string;
  private events: string[] = [];

  constructor(
    private readonly progressDir: string,
    private readonly issueNumber: number,
    private readonly issueTitle: string,
    private readonly logger: Logger,
  ) {
    this.progressPath = join(progressDir, 'progress.md');
  }

  /**
   * Write or update the per-issue progress file.
   */
  async write(
    phases: PhaseResult[],
    currentPhase: number,
    tasks: Array<{ id: string; name: string; status: string }>,
    tokenUsage: number,
  ): Promise<void> {
    await ensureDir(this.progressDir);

    let md = `# Issue #${this.issueNumber}: ${this.issueTitle}\n\n`;
    md += `## Pipeline Status\n`;
    md += `- **Current Phase**: ${currentPhase}/5\n`;
    md += `- **Token Usage**: ${tokenUsage.toLocaleString()}\n`;
    md += `- **Last Updated**: ${new Date().toISOString()}\n\n`;

    md += `## Phases\n\n`;
    md += `| # | Phase | Status | Duration |\n`;
    md += `|---|-------|--------|----------|`;

    for (let i = 0; i < 5; i++) {
      const phase = phases.find((p) => p.phase === i + 1);
      const name = phaseNames[i];
      const status = phase ? (phase.success ? '✅' : '❌') : i + 1 === currentPhase ? '🔄' : '⏳';
      const duration = phase ? `${(phase.duration / 1000).toFixed(1)}s` : '—';
      md += `\n| ${i + 1} | ${name} | ${status} | ${duration} |`;
    }

    const phasesWithGates = phases.filter((p) => p.gateResult != null);
    if (phasesWithGates.length > 0) {
      md += `\n\n## Gate Results\n`;
      for (const phase of phasesWithGates) {
        const gate = phase.gateResult!;
        const statusEmoji = gate.status === 'pass' ? '✅' : gate.status === 'warn' ? '⚠️' : '❌';
        md += `\n### Phase ${phase.phase}: ${phase.phaseName} — ${statusEmoji} ${gate.status}\n`;
        for (const err of gate.errors) {
          md += `- ❌ ${err}\n`;
        }
        for (const warn of gate.warnings) {
          md += `- ⚠️ ${warn}\n`;
        }
      }
    }

    if (tasks.length > 0) {
      md += `\n\n## Implementation Tasks\n\n`;
      md += `| Task | Name | Status |\n`;
      md += `|------|------|--------|`;
      for (const task of tasks) {
        const emoji = {
          completed: '✅',
          'in-progress': '🔄',
          blocked: '🚫',
          failed: '❌',
          'not-started': '⏳',
        }[task.status] ?? '⏳';
        md += `\n| ${task.id} | ${task.name} | ${emoji} ${task.status} |`;
      }
    }

    if (this.events.length > 0) {
      md += `\n\n## Event Log\n\n`;
      for (const event of this.events.slice(-30)) {
        md += `- ${event}\n`;
      }
    }

    md += '\n';

    await atomicWriteFile(this.progressPath, md);
  }

  async appendEvent(event: string): Promise<void> {
    const ts = new Date().toISOString().slice(11, 19);
    this.events.push(`\`${ts}\` ${event}`);
  }
}
