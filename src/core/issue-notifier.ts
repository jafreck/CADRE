import type { CadreConfig } from '../config/schema.js';
import type { PlatformProvider } from '../platform/provider.js';
import type { Logger } from '../logging/logger.js';

/**
 * Posts lifecycle comments to issues via the platform provider.
 * All methods are non-fatal — errors from `addIssueComment` are caught and logged.
 */
export class IssueNotifier {
  private readonly updates: CadreConfig['issueUpdates'];

  constructor(
    private readonly config: CadreConfig,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
  ) {
    this.updates = config.issueUpdates ?? { enabled: false, onStart: false, onPhaseComplete: false, onComplete: false, onFailed: false, onBudgetWarning: false };
  }

  /** Post a comment when an issue pipeline starts. */
  async notifyStart(issueNumber: number, issueTitle: string): Promise<void> {
    if (!this.updates.enabled || !this.updates.onStart) return;

    const body = [
      `## 🚀 CADRE Pipeline Started`,
      ``,
      `Processing **#${issueNumber}: ${issueTitle}**`,
      ``,
      `_Phases: Analysis → Planning → Implementation → Integration → PR_`,
    ].join('\n');

    await this.post(issueNumber, body);
  }

  /** Post a comment when a phase completes. */
  async notifyPhaseComplete(
    issueNumber: number,
    phaseId: number,
    phaseName: string,
    durationMs: number,
  ): Promise<void> {
    if (!this.updates.enabled || !this.updates.onPhaseComplete) return;

    const durationSec = (durationMs / 1000).toFixed(1);
    const body = [
      `## ✅ Phase ${phaseId} Complete: ${phaseName}`,
      ``,
      `**Duration:** ${durationSec}s`,
    ].join('\n');

    await this.post(issueNumber, body);
  }

  /** Post a comment when the pipeline completes successfully. */
  async notifyComplete(
    issueNumber: number,
    issueTitle: string,
    prUrl?: string,
    tokenUsage?: number,
  ): Promise<void> {
    if (!this.updates.enabled || !this.updates.onComplete) return;

    const lines = [
      `## 🎉 CADRE Pipeline Complete`,
      ``,
      `**#${issueNumber}: ${issueTitle}** has been implemented.`,
    ];

    if (prUrl) {
      lines.push(``, `**Pull Request:** ${prUrl}`);
    }

    if (tokenUsage != null) {
      lines.push(``, `**Tokens used:** ${tokenUsage.toLocaleString()}`);
    }

    await this.post(issueNumber, lines.join('\n'));
  }

  /** Post a comment when the pipeline fails. */
  async notifyFailed(
    issueNumber: number,
    issueTitle: string,
    phase?: { id: number; name: string },
    failedTask?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.updates.enabled || !this.updates.onFailed) return;

    const lines = [
      `## ❌ CADRE Pipeline Failed`,
      ``,
      `**#${issueNumber}: ${issueTitle}** encountered an error.`,
    ];

    if (phase) {
      lines.push(``, `**Failed at:** Phase ${phase.id} — ${phase.name}`);
    }

    if (failedTask) {
      lines.push(``, `**Failed task:** \`${failedTask}\``);
    }

    if (errorMessage) {
      lines.push(``, `**Error:**`, `\`\`\``, errorMessage, `\`\`\``);
    }

    await this.post(issueNumber, lines.join('\n'));
  }

  /** Post a comment when approaching the token budget limit. */
  async notifyBudgetWarning(
    issueNumber: number,
    tokenUsed: number,
    tokenBudget: number,
  ): Promise<void> {
    if (!this.updates.enabled || !this.updates.onBudgetWarning) return;

    const pct = ((tokenUsed / tokenBudget) * 100).toFixed(0);
    const body = [
      `## ⚠️ Token Budget Warning`,
      ``,
      `Issue **#${issueNumber}** is approaching its token limit.`,
      ``,
      `**Consumed:** ${tokenUsed.toLocaleString()} / ${tokenBudget.toLocaleString()} tokens (${pct}%)`,
    ].join('\n');

    await this.post(issueNumber, body);
  }

  /** Post a comment listing ambiguities and requesting clarification. */
  async notifyAmbiguities(issueNumber: number, ambiguities: string[]): Promise<void> {
    if (!this.updates.enabled) return;

    const list = ambiguities.map((a) => `- ${a}`).join('\n');
    const body = [
      `## ❓ Clarification Needed`,
      ``,
      `CADRE identified the following ambiguities in **#${issueNumber}** that require clarification before proceeding:`,
      ``,
      list,
    ].join('\n');

    await this.post(issueNumber, body);
  }

  private async post(issueNumber: number, body: string): Promise<void> {
    try {
      await this.platform.addIssueComment(issueNumber, body);
    } catch (err) {
      this.logger.warn(`Failed to post issue comment to #${issueNumber}: ${err}`, {
        issueNumber,
      });
    }
  }
}
