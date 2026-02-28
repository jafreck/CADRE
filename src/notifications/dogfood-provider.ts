import type { CadreEvent } from '../logging/events.js';
import type {
  NotificationProvider,
  DogfoodSeverity,
  DogfoodSignal,
  DogfoodTopic,
  DogfoodTriageResult,
} from './types.js';
import type { GitHubAPI } from '../github/api.js';

export interface DogfoodCollectorConfig {
  maxIssuesPerRun: number;
  labels: string[];
  titlePrefix: string;
  minimumIssueLevel: DogfoodSeverity;
}

const SEVERITY_RANK: Record<DogfoodSeverity, number> = {
  critical: 0,
  severe: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const LIFECYCLE_EVENT_TYPES = new Set([
  'fleet-started',
  'issue-started',
  'phase-started',
  'phase-completed',
  'phase-skipped',
]);

function getSubsystem(event: CadreEvent): string {
  if (event.type.startsWith('fleet-')) return 'fleet';
  if (event.type.startsWith('issue-')) return 'issue-pipeline';
  if (event.type.startsWith('phase-')) return 'phase';
  if (event.type.startsWith('agent-')) return 'agent';
  if (event.type.startsWith('task-')) return 'task';
  if (event.type.startsWith('git-') || event.type === 'pr-created') return 'git';
  if (event.type.startsWith('budget-') || event.type === 'ambiguity-detected') return 'budget';
  return 'unknown';
}

function getFailureMode(event: CadreEvent): string {
  switch (event.type) {
    case 'issue-failed':
      return 'issue-failure';
    case 'agent-failed':
      return event.timedOut ? 'agent-timeout' : 'agent-error';
    case 'task-blocked':
      return 'task-blocked';
    case 'task-retry':
      return 'task-retry';
    case 'budget-exceeded':
      return 'budget-exceeded';
    case 'budget-warning':
      return 'budget-warning';
    case 'fleet-interrupted':
      return 'fleet-interrupted';
    case 'fleet-completed':
      return (event as { success: boolean }).success ? 'info' : 'fleet-failure';
    case 'issue-completed':
      return (event as { success: boolean }).success ? 'info' : 'issue-failure';
    case 'ambiguity-detected':
      return 'ambiguity';
    default:
      return 'info';
  }
}

function getImpactScope(event: CadreEvent): string {
  if ('issueNumber' in event && typeof event.issueNumber === 'number') {
    return `issue-${event.issueNumber}`;
  }
  return 'fleet';
}

function classifySeverity(signals: DogfoodSignal[]): { severity: DogfoodSeverity; justification: string } {
  const types = new Set(signals.map((s) => s.event.type));
  const hasFleetInterrupted = types.has('fleet-interrupted');
  const hasBudgetExceeded = types.has('budget-exceeded');
  const hasIssueFailed = types.has('issue-failed');
  const hasAgentFailed = types.has('agent-failed');
  const hasTaskBlocked = types.has('task-blocked');
  const hasTaskRetry = types.has('task-retry');
  const hasBudgetWarning = types.has('budget-warning');
  const hasAmbiguity = types.has('ambiguity-detected');

  if (hasFleetInterrupted) {
    return { severity: 'critical', justification: 'Fleet was interrupted — all in-progress issues affected' };
  }
  if (hasBudgetExceeded) {
    return { severity: 'severe', justification: 'Budget exceeded — run halted or degraded' };
  }
  if (hasIssueFailed && signals.filter((s) => s.event.type === 'issue-failed').length > 1) {
    return { severity: 'severe', justification: 'Multiple issue failures detected' };
  }
  if (hasIssueFailed) {
    return { severity: 'high', justification: 'Issue pipeline failure' };
  }
  if (hasAgentFailed) {
    return { severity: 'high', justification: 'Agent failure detected' };
  }
  if (hasTaskBlocked) {
    return { severity: 'medium', justification: 'Task blocked after retries' };
  }
  if (hasTaskRetry || hasBudgetWarning) {
    return { severity: 'medium', justification: 'Task retries or budget warning observed' };
  }
  if (hasAmbiguity) {
    return { severity: 'low', justification: 'Ambiguity detected — may need human review' };
  }
  return { severity: 'low', justification: 'Informational signals only' };
}

export class DogfoodCollector implements NotificationProvider {
  private readonly signals: DogfoodSignal[] = [];

  constructor(
    private readonly github: GitHubAPI,
    private readonly config: DogfoodCollectorConfig,
  ) {}

  async notify(event: CadreEvent): Promise<void> {
    this.signals.push({ event, timestamp: new Date().toISOString() });
  }

  async runTriage(): Promise<DogfoodTriageResult> {
    const result: DogfoodTriageResult = { filed: [], skippedBelowThreshold: [], skippedOverCap: [] };

    try {
      // 1. Filter out lifecycle-only signals for topic creation
      const actionableSignals = this.signals.filter((s) => !LIFECYCLE_EVENT_TYPES.has(s.event.type));
      if (actionableSignals.length === 0) {
        return result;
      }

      // 2. Topic clustering by subsystem + failure mode + impact scope
      const topicMap = new Map<string, DogfoodSignal[]>();
      for (const signal of actionableSignals) {
        const subsystem = getSubsystem(signal.event);
        const failureMode = getFailureMode(signal.event);
        const impactScope = getImpactScope(signal.event);
        const key = `${subsystem}:${failureMode}:${impactScope}`;
        const group = topicMap.get(key) ?? [];
        group.push(signal);
        topicMap.set(key, group);
      }

      // Build topic objects with severity
      const allTopics: DogfoodTopic[] = [];
      for (const [key, signals] of topicMap) {
        const [subsystem, failureMode, impactScope] = key.split(':');
        // Attach lifecycle signals as supporting evidence
        const supportingLifecycle = this.signals.filter(
          (s) => LIFECYCLE_EVENT_TYPES.has(s.event.type) && getImpactScope(s.event) === impactScope,
        );
        const allSignals = [...signals, ...supportingLifecycle];
        const { severity, justification } = classifySeverity(signals);

        allTopics.push({
          key,
          severity,
          severityJustification: justification,
          summary: `${subsystem} ${failureMode} in ${impactScope} (${signals.length} signal${signals.length > 1 ? 's' : ''})`,
          signals: allSignals,
          subsystem,
          failureMode,
          impactScope,
        });
      }

      // Sort by severity (most severe first)
      allTopics.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

      // 3. Threshold filtering
      const minRank = SEVERITY_RANK[this.config.minimumIssueLevel];
      const aboveThreshold: DogfoodTopic[] = [];
      for (const topic of allTopics) {
        if (SEVERITY_RANK[topic.severity] <= minRank) {
          aboveThreshold.push(topic);
        } else {
          result.skippedBelowThreshold.push(topic);
          console.log(
            `DogfoodCollector: skipping topic "${topic.key}" (severity=${topic.severity}) — below threshold "${this.config.minimumIssueLevel}"`,
          );
        }
      }

      // 4. Max issues per run enforcement
      for (let i = 0; i < aboveThreshold.length; i++) {
        if (i < this.config.maxIssuesPerRun) {
          result.filed.push(aboveThreshold[i]);
        } else {
          result.skippedOverCap.push(aboveThreshold[i]);
          console.log(
            `DogfoodCollector: capping topic "${aboveThreshold[i].key}" (rank=${i + 1}, severity=${aboveThreshold[i].severity}) — exceeds maxIssuesPerRun=${this.config.maxIssuesPerRun}`,
          );
        }
      }

      // 5. File GitHub issues for accepted topics
      for (const topic of result.filed) {
        try {
          const title = `${this.config.titlePrefix} ${topic.summary}`;
          const body = this.buildIssueBody(topic);
          await this.github.createIssue({
            title,
            body,
            labels: [...this.config.labels, ...this.suggestLabels(topic)],
          });
        } catch (err) {
          console.error(`DogfoodCollector: failed to file issue for topic "${topic.key}": ${err}`);
        }
      }
    } catch (err) {
      console.error(`DogfoodCollector: triage failed: ${err}`);
    }

    return result;
  }

  private buildIssueBody(topic: DogfoodTopic): string {
    const timestamps = topic.signals.map((s) => s.timestamp);
    const affectedIssues = new Set<number>();
    for (const s of topic.signals) {
      if ('issueNumber' in s.event && typeof s.event.issueNumber === 'number') {
        affectedIssues.add(s.event.issueNumber);
      }
    }

    const lines = [
      `## Topic: \`${topic.key}\``,
      '',
      `**Severity:** ${topic.severity}`,
      `**Justification:** ${topic.severityJustification}`,
      '',
      `### Summary`,
      '',
      topic.summary,
      '',
      `### Aggregation Evidence`,
      '',
      `- **Signal count:** ${topic.signals.length}`,
      `- **Affected issues:** ${affectedIssues.size > 0 ? [...affectedIssues].map((n) => `#${n}`).join(', ') : 'fleet-level'}`,
      `- **Time range:** ${timestamps[0]} — ${timestamps[timestamps.length - 1]}`,
      '',
      `### Reproducibility Hints`,
      '',
      `- Subsystem: \`${topic.subsystem}\``,
      `- Failure mode: \`${topic.failureMode}\``,
      `- Impact scope: \`${topic.impactScope}\``,
      '',
      `### Suggested Labels`,
      '',
      this.suggestLabels(topic).map((l) => `- \`${l}\``).join('\n'),
      '',
      '### Signals',
      '',
      '```json',
      JSON.stringify(
        topic.signals.map((s) => ({ type: s.event.type, timestamp: s.timestamp })),
        null,
        2,
      ),
      '```',
    ];

    return lines.join('\n');
  }

  private suggestLabels(topic: DogfoodTopic): string[] {
    const labels: string[] = [];
    labels.push(`component:${topic.subsystem}`);
    if (topic.severity === 'critical' || topic.severity === 'severe') {
      labels.push('priority:high');
    }
    return labels;
  }
}
