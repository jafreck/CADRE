import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IssueDetail } from '../platform/provider.js';
import type { RuntimeConfig } from '../config/loader.js';
import type { AgentLauncher } from './agent-launcher.js';
import type { WorktreeManager } from '../git/worktree.js';
import { IssueDag } from './issue-dag.js';
import { CyclicDependencyError, DependencyResolutionError } from '../errors.js';
import { Logger } from '../logging/logger.js';
import { extractCadreJson } from '@cadre/agent-runtime';

/** Zod schema for the dependency-analyst agent output: maps issue number (string key) to list of dependency issue numbers. */
export const depMapSchema = z.record(z.string(), z.array(z.number()));

export type DepMapOutput = z.infer<typeof depMapSchema>;

/**
 * Invokes the dependency-analyst agent to infer a dependency graph over a
 * set of issues, then constructs an IssueDag.
 *
 * Retry policy:
 * - On malformed JSON or Zod validation failure: one retry (no hint).
 * - On CyclicDependencyError from IssueDag: one retry with a hint to remove cycles.
 * - After exhausting retries: throws DependencyResolutionError.
 */
export class DependencyResolver {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly launcher: AgentLauncher,
    private readonly logger: Logger,
    private readonly worktreeManager?: WorktreeManager,
  ) {}

  async resolve(issues: IssueDetail[], repoPath: string): Promise<IssueDag> {
    const validIssueNumbers = new Set(issues.map((i) => i.number));
    let cycleHint: string | undefined;

    // Provision the worktree once for all retry attempts, then clean it up.
    const runId = randomUUID();
    const agentCwd = this.worktreeManager
      ? await this.worktreeManager.provisionForDependencyAnalyst(runId)
      : repoPath;

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const rawOutput = await this.invokeAgent(issues, agentCwd, cycleHint);

        // Parse and Zod-validate the output.
        // The agent must emit a cadre-json fenced block in dep-map.md.
        let rawDepMap: DepMapOutput;
        try {
          const parsed = extractCadreJson(rawOutput);
          if (parsed === null || parsed === undefined) {
            throw new Error('Agent output is missing a cadre-json block');
          }
          rawDepMap = depMapSchema.parse(parsed);
        } catch (err) {
          if (attempt === 0) {
            this.logger.warn('DependencyResolver: malformed JSON on first attempt, retrying');
            continue;
          }
          throw new DependencyResolutionError(
            `Dependency analyst produced invalid output after retry: ${String(err)}`,
          );
        }

        // Filter to only issue numbers present in the provided issue list
        const filteredDepMap: Record<number, number[]> = {};
        for (const [key, deps] of Object.entries(rawDepMap)) {
          const issueNum = parseInt(key, 10);
          if (!validIssueNumbers.has(issueNum)) continue;
          filteredDepMap[issueNum] = deps.filter((d) => validIssueNumbers.has(d));
        }

        try {
          return new IssueDag(issues, filteredDepMap);
        } catch (err) {
          if (err instanceof CyclicDependencyError) {
            if (attempt === 0) {
              cycleHint =
                'The previous dependency graph contained cycles. Please produce an acyclic dependency graph with no cycles.';
              this.logger.warn('DependencyResolver: cycle detected on first attempt, retrying with hint');
              continue;
            }
            throw new DependencyResolutionError(`Cycle detected after retry: ${err.message}`);
          }
          throw err;
        }
      }

      throw new DependencyResolutionError('Dependency resolution failed after all retries');
    } finally {
      if (this.worktreeManager) {
        await this.worktreeManager.removeWorktreeAtPath(agentCwd);
      }
    }
  }

  private async invokeAgent(
    issues: IssueDetail[],
    agentCwd: string,
    hint?: string,
  ): Promise<string> {
    const invocationId = randomUUID();
    const tmpDir = join(tmpdir(), `cadre-dep-resolver-${invocationId}`);
    await mkdir(tmpDir, { recursive: true });

    const contextPath = join(tmpDir, 'context.json');
    const outputPath = join(tmpDir, 'dep-map.md');

    const context = {
      agent: 'dependency-analyst',
      issueNumber: 0,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath: agentCwd,
      phase: 1,
      config: { commands: this.config.commands ?? {} },
      inputFiles: [],
      outputPath,
      payload: { issues, ...(hint !== undefined ? { hint } : {}) },
    };

    await writeFile(contextPath, JSON.stringify(context, null, 2), 'utf-8');

    const result = await this.launcher.launchAgent(
      {
        agent: 'dependency-analyst',
        issueNumber: 0,
        phase: 1,
        contextPath,
        outputPath,
      },
      agentCwd,
    );

    if (!result.success || !result.outputExists) {
      throw new DependencyResolutionError(
        `Dependency analyst agent failed: ${result.error ?? 'no output produced'}`,
      );
    }

    return readFile(outputPath, 'utf-8');
  }
}
