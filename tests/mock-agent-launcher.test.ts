import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MockAgentLauncher } from './helpers/mock-agent-launcher.js';
import type { AgentInvocation } from '../src/agents/types.js';

function makeInvocation(
  overrides: Partial<AgentInvocation> & { outputDir?: string },
): AgentInvocation {
  const outputDir = overrides.outputDir ?? join(tmpdir(), randomUUID());
  const agent = overrides.agent ?? 'issue-analyst';
  const outputFile = overrides.outputPath ?? join(outputDir, 'output.md');
  return {
    agent,
    issueNumber: 1,
    phase: 1,
    contextPath: join(outputDir, 'context.json'),
    outputPath: outputFile,
    ...overrides,
  };
}

describe('MockAgentLauncher', () => {
  let launcher: MockAgentLauncher;

  beforeEach(() => {
    launcher = new MockAgentLauncher();
  });

  describe('launchAgent - basic result shape', () => {
    it('returns a successful AgentResult with correct agent name', async () => {
      const inv = makeInvocation({ agent: 'issue-analyst' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.agent).toBe('issue-analyst');
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('returns outputExists: true after writing synthetic file', async () => {
      const inv = makeInvocation({ agent: 'codebase-scout' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.outputExists).toBe(true);
      expect(result.outputPath).toBe(inv.outputPath);
    });

    it('returns default tokenUsage of 500', async () => {
      const inv = makeInvocation({ agent: 'implementation-planner' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.tokenUsage).toBe(500);
    });

    it('returns duration as a non-negative number', async () => {
      const inv = makeInvocation({ agent: 'pr-composer' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('returns empty stdout and stderr on success', async () => {
      const inv = makeInvocation({ agent: 'code-reviewer' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.error).toBeUndefined();
    });
  });

  describe('synthetic output files', () => {
    it('writes analysis content for issue-analyst', async () => {
      const inv = makeInvocation({ agent: 'issue-analyst' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content).toContain('## Requirements');
      expect(content).toContain('Change Type');
    });

    it('writes scout report content for codebase-scout', async () => {
      const inv = makeInvocation({ agent: 'codebase-scout' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content).toContain('Scout Report');
      expect(content).toContain('Relevant Files');
    });

    it('writes implementation plan content for implementation-planner', async () => {
      const inv = makeInvocation({ agent: 'implementation-planner' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content).toContain('Implementation Plan');
      expect(content).toContain('task-001');
      expect(content).toContain('task-002');
      expect(content).toContain('Dependencies:');
    });

    it('writes review content for code-reviewer with verdict pass', async () => {
      const inv = makeInvocation({ agent: 'code-reviewer' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content).toContain('Verdict');
      expect(content.toLowerCase()).toContain('pass');
    });

    it('writes PR content for pr-composer', async () => {
      const inv = makeInvocation({ agent: 'pr-composer' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content).toContain('title:');
      expect(content).toContain('Summary');
    });

    it('writes fallback content for unknown agents', async () => {
      const inv = makeInvocation({ agent: 'code-writer' });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('dispatches by output file basename when agent name does not match', async () => {
      const inv = makeInvocation({
        agent: 'code-writer',
        outputPath: join(tmpdir(), randomUUID(), 'review-task-001.md'),
      });
      await launcher.launchAgent(inv, '/worktree');
      const content = await readFile(inv.outputPath, 'utf-8');
      expect(content.toLowerCase()).toContain('pass');
    });
  });

  describe('registerHandler', () => {
    it('calls the registered handler and merges its partial result', async () => {
      launcher.registerHandler('issue-analyst', () => ({ stdout: 'custom-stdout', tokenUsage: 999 }));
      const inv = makeInvocation({ agent: 'issue-analyst' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.stdout).toBe('custom-stdout');
      expect(result.tokenUsage).toBe(999);
      expect(result.success).toBe(true);
    });

    it('still writes synthetic output even when handler is registered', async () => {
      launcher.registerHandler('codebase-scout', () => ({}));
      const inv = makeInvocation({ agent: 'codebase-scout' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.outputExists).toBe(true);
    });

    it('async handler is awaited properly', async () => {
      launcher.registerHandler('implementation-planner', async () => {
        await new Promise((r) => setTimeout(r, 0));
        return { stdout: 'async-result' };
      });
      const inv = makeInvocation({ agent: 'implementation-planner' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.stdout).toBe('async-result');
    });
  });

  describe('registerTaskHandler', () => {
    it('uses task-specific handler when taskId matches', async () => {
      launcher.registerHandler('code-writer', () => ({ tokenUsage: 111 }));
      launcher.registerTaskHandler('code-writer', 'task-001', () => ({ tokenUsage: 222 }));
      const inv = makeInvocation({ agent: 'code-writer', taskId: 'task-001' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.tokenUsage).toBe(222);
    });

    it('falls back to agent handler when taskId does not match registered task handler', async () => {
      launcher.registerHandler('code-writer', () => ({ tokenUsage: 111 }));
      launcher.registerTaskHandler('code-writer', 'task-002', () => ({ tokenUsage: 222 }));
      const inv = makeInvocation({ agent: 'code-writer', taskId: 'task-001' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.tokenUsage).toBe(111);
    });

    it('uses agent handler when invocation has no taskId', async () => {
      launcher.registerHandler('code-writer', () => ({ tokenUsage: 333 }));
      launcher.registerTaskHandler('code-writer', 'task-001', () => ({ tokenUsage: 444 }));
      const inv = makeInvocation({ agent: 'code-writer' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.tokenUsage).toBe(333);
    });
  });

  describe('failOn', () => {
    it('returns success: false when agent matches failOn', async () => {
      launcher.failOn('issue-analyst');
      const inv = makeInvocation({ agent: 'issue-analyst' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('Mock failure');
      expect(result.stderr).toBe('Mock failure');
    });

    it('does not write synthetic output when failing', async () => {
      launcher.failOn('codebase-scout');
      const inv = makeInvocation({ agent: 'codebase-scout' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.outputExists).toBe(false);
    });

    it('scoped failOn(agent, taskId) only fails the specific task', async () => {
      launcher.failOn('code-writer', 'task-001');
      const failInv = makeInvocation({ agent: 'code-writer', taskId: 'task-001' });
      const okInv = makeInvocation({ agent: 'code-writer', taskId: 'task-002' });

      const failResult = await launcher.launchAgent(failInv, '/worktree');
      const okResult = await launcher.launchAgent(okInv, '/worktree');

      expect(failResult.success).toBe(false);
      expect(okResult.success).toBe(true);
    });

    it('scoped failOn does not affect agent-level invocations without a taskId', async () => {
      launcher.failOn('code-writer', 'task-001');
      const inv = makeInvocation({ agent: 'code-writer' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.success).toBe(true);
    });

    it('agent-level failOn also fails task-scoped invocations', async () => {
      launcher.failOn('code-writer');
      const inv = makeInvocation({ agent: 'code-writer', taskId: 'task-001' });
      const result = await launcher.launchAgent(inv, '/worktree');
      expect(result.success).toBe(false);
    });
  });
});
