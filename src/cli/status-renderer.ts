import type { CadreConfig } from '../config/schema.js';
import type { FleetCheckpointState, FleetIssueStatus, CheckpointState } from '../core/checkpoint.js';
import { phaseNames } from '../core/progress.js';
import { CostEstimator } from '../budget/cost-estimator.js';

const STATUS_EMOJI: Record<FleetIssueStatus['status'], string> = {
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
};

/**
 * Converts an ISO timestamp to a human-readable elapsed string like "5m ago" or "2h ago".
 */
export function formatElapsed(isoDate?: string): string {
  if (!isoDate) return '—';
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (isNaN(diffMs) || diffMs < 0) return '—';
  if (diffMs < 60_000) return 'just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * Renders a fleet-wide status table as a string.
 * No file I/O performed — all data passed as parameters.
 */
export function renderFleetStatus(
  state: FleetCheckpointState,
  model?: string,
  copilotConfig?: CadreConfig['copilot'],
): string {
  const estimator = new CostEstimator(
    copilotConfig ?? { cliCommand: 'copilot', model: 'claude-sonnet-4.6', agentDir: '.github/agents', timeout: 300_000 },
  );

  const totalTokens = state.tokenUsage.total;
  const totalCostEst = estimator.estimate(totalTokens, model ?? copilotConfig?.model);
  const totalCostStr = totalTokens > 0 ? `$${totalCostEst.totalCost.toFixed(4)}` : '$0.0000';
  const header = [
    `Project: ${state.projectName}`,
    `Total Tokens: ${totalTokens.toLocaleString()}`,
    `Estimated Cost: ${totalCostStr}`,
    `Last Checkpoint: ${formatElapsed(state.lastCheckpoint)}`,
  ].join('  |  ');

  const rows: string[][] = [];
  for (const [issueNumStr, issue] of Object.entries(state.issues)) {
    const issueNum = Number(issueNumStr);
    const tokens = state.tokenUsage.byIssue[issueNum] ?? 0;
    const costEst = estimator.estimate(tokens, model ?? copilotConfig?.model);
    const costStr = tokens > 0 ? `$${costEst.totalCost.toFixed(4)}` : '—';
    const phaseIdx = Math.max(0, issue.lastPhase - 1);
    const phaseName = phaseIdx >= 0 && phaseIdx < phaseNames.length ? phaseNames[phaseIdx] : `Phase ${issue.lastPhase}`;
    rows.push([
      `#${issueNum}`,
      issue.issueTitle,
      `${STATUS_EMOJI[issue.status]} ${issue.status}`,
      phaseName,
      tokens > 0 ? tokens.toLocaleString() : '0',
      costStr,
      issue.branchName || '—',
      formatElapsed(issue.updatedAt),
    ]);
  }

  const headers = ['Issue', 'Title', 'Status', 'Phase', 'Tokens', 'Cost', 'Branch', 'Updated'];
  return header + '\n\n' + renderTable(headers, rows);
}

/**
 * Renders a per-issue phase breakdown table as a string.
 * Includes gate results and errors/warnings below the table.
 * No file I/O performed — all data passed as parameters.
 */
export function renderIssueDetail(
  issueNumber: number,
  issueStatus: FleetIssueStatus,
  checkpoint: CheckpointState,
): string {
  const rows: string[][] = [];
  for (let i = 0; i < phaseNames.length; i++) {
    const phaseNum = i + 1;
    const name = phaseNames[i];
    const tokens = checkpoint.tokenUsage.byPhase[phaseNum] ?? 0;
    let statusEmoji: string;
    if (checkpoint.completedPhases.includes(phaseNum)) {
      statusEmoji = '✅';
    } else if (checkpoint.currentPhase === phaseNum) {
      statusEmoji = '🔄';
    } else {
      statusEmoji = '⏳';
    }
    const gate = checkpoint.gateResults?.[phaseNum];
    const gateStr = gate
      ? gate.status === 'pass' ? '✅ pass' : gate.status === 'warn' ? '⚠️ warn' : '❌ fail'
      : '—';
    rows.push([
      String(phaseNum),
      name,
      statusEmoji,
      tokens > 0 ? tokens.toLocaleString() : '—',
      gateStr,
    ]);
  }

  const headers = ['Phase', 'Name', 'Status', 'Tokens', 'Gate'];
  let out = `Issue #${issueNumber}: ${issueStatus.issueTitle}\n`;
  out += renderTable(headers, rows);

  if (checkpoint.gateResults) {
    const gateEntries = Object.entries(checkpoint.gateResults);
    if (gateEntries.length > 0) {
      out += '\n\nGate Results:\n';
      for (const [phaseStr, gate] of gateEntries) {
        const phaseIdx = Number(phaseStr) - 1;
        const phaseName = phaseIdx >= 0 && phaseIdx < phaseNames.length ? phaseNames[phaseIdx] : `Phase ${phaseStr}`;
        const gateEmoji = gate.status === 'pass' ? '✅' : gate.status === 'warn' ? '⚠️' : '❌';
        out += `  Phase ${phaseStr} (${phaseName}): ${gateEmoji} ${gate.status}\n`;
        for (const err of gate.errors) {
          out += `    ❌ ${err}\n`;
        }
        for (const warn of gate.warnings) {
          out += `    ⚠️  ${warn}\n`;
        }
      }
    }
  }

  return out;
}

function renderTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((row) => (row[colIdx] ?? '').length)),
  );

  const formatRow = (row: string[]) =>
    '| ' + row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |';

  const separator = '|-' + colWidths.map((w) => '-'.repeat(w)).join('-|-') + '-|';

  const lines = [formatRow(headers), separator, ...rows.map(formatRow)];
  return lines.join('\n');
}
