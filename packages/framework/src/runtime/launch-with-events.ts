/**
 * Agent launch with invocation‐ID correlation, lifecycle event emission,
 * and metrics recording.
 *
 * Every agent invocation in a pipeline should go through this wrapper so that:
 * 1. A unique invocation ID tags the launch for end-to-end tracing.
 * 2. `agent-launched`, `agent-completed`, and `agent-failed` events are
 *    emitted via `logger.event()`.
 * 3. Cost is computed via `CostEstimator`, an `InvocationMetric` record is
 *    built, and writing is delegated to a `MetricsCollector`.
 *
 * ~77 LOC, modelled after AAMF's shared.ts.
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentInvocation, AgentResult, TokenUsageDetail } from './context/types.js';
import type { CostEstimator, CostEstimate } from '../core/cost-estimator.js';
import type { RuntimeEvent } from '../core/events.js';

// ── Types ──

/** Minimal logger surface needed by launchAgentWithEvents. */
export interface EventLogger {
  event(event: RuntimeEvent, level?: 'debug' | 'info' | 'warn' | 'error'): void;
}

/** A single recorded metric for one agent invocation. */
export interface InvocationMetric {
  invocationId: string;
  runId: string;
  agent: string;
  workItemId: string;
  phase: number;
  taskId?: string;
  model?: string;
  tokens: number;
  /** Input token count (when breakdown is available). */
  inputTokens?: number;
  /** Output token count (when breakdown is available). */
  outputTokens?: number;
  /** Cached input tokens (prompt cache hits). */
  cachedTokens?: number;
  cost?: number;
  routing?: { mode?: string; complexity?: string; reason?: string };
  duration: number;
  success: boolean;
  /** Invocation outcome with finer granularity than boolean success. */
  status?: 'success' | 'failed' | 'cancelled' | 'timed-out';
  exitCode: number | null;
  /** ISO timestamp when the invocation started. */
  startTime: string;
  /** ISO timestamp when the invocation completed (same as legacy `timestamp`). */
  timestamp: string;
  /** Which attempt this was (1-based), when executed inside a retry loop. */
  attemptNumber?: number;
  /** Total attempts configured, when executed inside a retry loop. */
  maxAttempts?: number;
  /** Whether this invocation was a retry of a previously failed attempt. */
  wasRetry?: boolean;
}

/**
 * Abstraction for metric persistence.
 * Implementations may write JSONL, send to a telemetry endpoint, etc.
 */
export interface MetricsCollector {
  record(metric: InvocationMetric): Promise<void>;
}

/**
 * Simple JSONL-file-backed MetricsCollector.
 * Appends one JSON line per invocation to the given path.
 */
export class JsonlMetricsCollector implements MetricsCollector {
  constructor(private readonly path: string) {}

  async record(metric: InvocationMetric): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(metric) + '\n', 'utf-8');
  }
}

export interface AgentLauncherLike {
  launchAgent(invocation: AgentInvocation, worktreePath?: string): Promise<AgentResult>;
}

// ── Options / Result ──

export interface LaunchAgentWithEventsOptions {
  launcher: AgentLauncherLike;
  invocation: AgentInvocation;
  worktreePath: string;
  /** Pipeline-level run ID for correlation across invocations. */
  runId: string;
  logger: EventLogger;
  costEstimator?: CostEstimator;
  /** Model used for this invocation (for cost estimation and metric tagging). */
  model?: string;
  /** Model routing metadata to record on the metric. */
  routing?: { mode?: string; complexity?: string; reason?: string };
  metricsCollector?: MetricsCollector;
  /** Called after metrics are recorded — use to increment checkpoint.metricsCount. */
  onMetricRecorded?: () => Promise<void> | void;
}

export interface LaunchAgentWithEventsResult {
  invocationId: string;
  result: AgentResult;
  metric: InvocationMetric;
  costEstimate?: CostEstimate;
}

// ── Helpers ──

function extractTotalTokens(usage: AgentResult['tokenUsage']): number {
  if (typeof usage === 'number') return usage;
  if (usage && typeof usage === 'object') return (usage as TokenUsageDetail).input + (usage as TokenUsageDetail).output;
  return 0;
}

function extractTokenBreakdown(usage: AgentResult['tokenUsage']): { inputTokens?: number; outputTokens?: number; cachedTokens?: number } {
  if (usage && typeof usage === 'object') {
    const detail = usage as TokenUsageDetail;
    return {
      inputTokens: detail.input,
      outputTokens: detail.output,
      cachedTokens: detail.cachedInput,
    };
  }
  return {};
}

// ── Core ──

export async function launchAgentWithEvents(
  opts: LaunchAgentWithEventsOptions,
): Promise<LaunchAgentWithEventsResult> {
  const invocationId = randomUUID();
  const {
    launcher, invocation, worktreePath, runId,
    logger, costEstimator, model, routing,
    metricsCollector, onMetricRecorded,
  } = opts;

  // 1. Emit agent-launched
  logger.event({
    type: 'agent-launched',
    agent: invocation.agent,
    workItemId: invocation.workItemId,
    taskId: invocation.sessionId,
    worktreePath,
  });

  const startTime = Date.now();
  let result: AgentResult;

  try {
    result = await launcher.launchAgent(invocation, worktreePath);
  } catch (error) {
    logger.event({
      type: 'agent-failed',
      agent: invocation.agent,
      workItemId: invocation.workItemId,
      taskId: invocation.sessionId,
      error: String(error),
      timedOut: false,
    }, 'error');
    throw error;
  }

  const duration = Date.now() - startTime;
  const tokens = extractTotalTokens(result.tokenUsage);

  // 2. Emit agent-completed or agent-failed
  if (result.success) {
    logger.event({
      type: 'agent-completed',
      agent: invocation.agent,
      workItemId: invocation.workItemId,
      taskId: invocation.sessionId,
      exitCode: result.exitCode ?? 0,
      duration,
      tokenUsage: tokens,
    });
  } else {
    logger.event({
      type: 'agent-failed',
      agent: invocation.agent,
      workItemId: invocation.workItemId,
      taskId: invocation.sessionId,
      error: result.error ?? `exit code ${result.exitCode}`,
      timedOut: result.timedOut,
    }, 'error');
  }

  // 3. Cost estimation + metric recording
  const breakdown = extractTokenBreakdown(result.tokenUsage);
  let costEstimate: CostEstimate | undefined;
  if (costEstimator) {
    // Use detailed estimation when input/output breakdown is available
    if (breakdown.inputTokens != null && breakdown.outputTokens != null) {
      costEstimate = breakdown.cachedTokens != null
        ? costEstimator.estimateWithCache(breakdown.inputTokens, breakdown.outputTokens, breakdown.cachedTokens, model)
        : costEstimator.estimateDetailed(breakdown.inputTokens, breakdown.outputTokens, model);
    } else {
      costEstimate = costEstimator.estimate(tokens, model);
    }
  }

  const startIso = new Date(startTime).toISOString();

  const metric: InvocationMetric = {
    invocationId,
    runId,
    agent: invocation.agent,
    workItemId: invocation.workItemId,
    phase: invocation.phase,
    taskId: invocation.sessionId,
    model,
    tokens,
    inputTokens: breakdown.inputTokens,
    outputTokens: breakdown.outputTokens,
    cachedTokens: breakdown.cachedTokens,
    cost: costEstimate?.totalCost,
    routing,
    duration,
    success: result.success,
    status: result.timedOut ? 'timed-out' : result.success ? 'success' : 'failed',
    exitCode: result.exitCode,
    startTime: startIso,
    timestamp: new Date().toISOString(),
  };

  if (metricsCollector) {
    try {
      await metricsCollector.record(metric);
      await onMetricRecorded?.();
    } catch {
      // Best-effort metric recording
    }
  }

  return { invocationId, result, metric, costEstimate };
}
