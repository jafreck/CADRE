/**
 * End-to-end test for MCP config serialization through the backend invoke pipeline.
 *
 * Exercises the real CopilotBackend/ClaudeBackend → runInvokePipeline() → spawnProcess path
 * with only spawnProcess mocked at the process boundary, validating that mcpServers on an
 * AgentInvocation are correctly serialized into CLI arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/runtime/commands/exec.js', () => ({
  spawnProcess: vi.fn(),
  stripVSCodeEnv: vi.fn((env: Record<string, string | undefined>) => ({ ...env })),
  trackProcess: vi.fn(),
  killAllTrackedProcesses: vi.fn(),
  getTrackedProcessCount: vi.fn(() => 0),
  exec: vi.fn(),
  execShell: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}));

import { CopilotBackend, ClaudeBackend } from '../../../src/runtime/backend/backend.js';
import type { BackendRuntimeConfig, BackendLoggerLike } from '../../../src/runtime/backend/contract.js';
import type { AgentInvocation } from '../../../src/runtime/context/types.js';
import { spawnProcess } from '../../../src/runtime/commands/exec.js';

const mockSpawnProcess = vi.mocked(spawnProcess);

function makeLogger(): BackendLoggerLike {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeInvocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    agent: 'code-writer',
    workItemId: '42',
    phase: 3,
    sessionId: 'session-001',
    contextPath: '/tmp/worktree/.cadre/issues/42/contexts/ctx.json',
    outputPath: '/tmp/worktree/.cadre/issues/42/outputs/result.md',
    ...overrides,
  };
}

function setupSpawn(overrides: Partial<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> = {}) {
  const result = {
    exitCode: overrides.exitCode ?? 0,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    signal: null,
    timedOut: overrides.timedOut ?? false,
  };
  mockSpawnProcess.mockReturnValue({
    promise: Promise.resolve(result),
    process: {} as never,
  });
}

describe('e2e: MCP config serialization through backend invoke pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CopilotBackend', () => {
    function makeCopilotConfig(): BackendRuntimeConfig {
      return {
        agent: {
          backend: 'copilot',
          model: 'claude-sonnet-4.6',
          timeout: 300_000,
          copilot: {
            cliCommand: 'copilot',
            agentDir: '.github/agents',
            allowAllTools: true,
            allowAllPaths: true,
          },
          claude: { cliCommand: 'claude' },
        },
        environment: { extraPath: [] },
      };
    }

    it('should wrap MCP config in mcpServers key for --additional-mcp-config', async () => {
      setupSpawn();
      const backend = new CopilotBackend(makeCopilotConfig(), makeLogger());

      await backend.invoke(
        makeInvocation({ mcpServers: { 'aamf-kb': { url: 'http://localhost:9000/sse' } } }),
        '/tmp/worktree',
      );

      const [cmd, args] = mockSpawnProcess.mock.calls[0];
      expect(cmd).toBe('copilot');

      const mcpIdx = args.indexOf('--additional-mcp-config');
      expect(mcpIdx).toBeGreaterThanOrEqual(0);
      const mcpPayload = JSON.parse(args[mcpIdx + 1]);

      // The Copilot CLI requires the top-level mcpServers wrapper
      expect(mcpPayload).toEqual({
        mcpServers: { 'aamf-kb': { url: 'http://localhost:9000/sse' } },
      });
      // Ensure the old broken format (without wrapper) is NOT used
      expect(mcpPayload).not.toEqual({
        'aamf-kb': { url: 'http://localhost:9000/sse' },
      });
    });

    it('should produce separate --additional-mcp-config args per MCP server, each with mcpServers wrapper', async () => {
      setupSpawn();
      const backend = new CopilotBackend(makeCopilotConfig(), makeLogger());

      await backend.invoke(
        makeInvocation({
          mcpServers: {
            'aamf-kb': { url: 'http://localhost:9000/sse' },
            'docs-server': { url: 'http://localhost:9001/sse' },
          },
        }),
        '/tmp/worktree',
      );

      const [, args] = mockSpawnProcess.mock.calls[0];

      // Collect all --additional-mcp-config values
      const mcpPayloads: unknown[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--additional-mcp-config') {
          mcpPayloads.push(JSON.parse(args[i + 1]));
        }
      }

      expect(mcpPayloads).toHaveLength(2);

      // Each payload must have the mcpServers wrapper with exactly one server
      for (const payload of mcpPayloads) {
        expect(payload).toHaveProperty('mcpServers');
        expect(Object.keys((payload as Record<string, unknown>).mcpServers as object)).toHaveLength(1);
      }

      // Verify specific servers are present
      const allServerNames = mcpPayloads.flatMap(
        (p) => Object.keys((p as Record<string, Record<string, unknown>>).mcpServers),
      );
      expect(allServerNames).toContain('aamf-kb');
      expect(allServerNames).toContain('docs-server');
    });

    it('should not include --additional-mcp-config when mcpServers is absent', async () => {
      setupSpawn();
      const backend = new CopilotBackend(makeCopilotConfig(), makeLogger());

      await backend.invoke(makeInvocation(), '/tmp/worktree');

      const [, args] = mockSpawnProcess.mock.calls[0];
      expect(args).not.toContain('--additional-mcp-config');
    });
  });

  describe('ClaudeBackend', () => {
    function makeClaudeConfig(): BackendRuntimeConfig {
      return {
        agent: {
          backend: 'claude',
          model: 'claude-sonnet-4.6',
          timeout: 300_000,
          copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
          claude: {
            cliCommand: 'claude',
            allowedTools: 'Bash,Read,Write,Edit',
          },
        },
        environment: { extraPath: [] },
      };
    }

    it('should serialize MCP config with type: url for --mcp-config (no mcpServers wrapper)', async () => {
      setupSpawn();
      const backend = new ClaudeBackend(makeClaudeConfig(), makeLogger());

      await backend.invoke(
        makeInvocation({ mcpServers: { 'aamf-kb': { url: 'http://localhost:9000/sse' } } }),
        '/tmp/worktree',
      );

      const [cmd, args] = mockSpawnProcess.mock.calls[0];
      expect(cmd).toBe('claude');

      const mcpIdx = args.indexOf('--mcp-config');
      expect(mcpIdx).toBeGreaterThanOrEqual(0);
      const mcpPayload = JSON.parse(args[mcpIdx + 1]);

      // Claude uses {name: {type: 'url', url: ...}} format (no mcpServers wrapper)
      expect(mcpPayload).toEqual({
        'aamf-kb': { type: 'url', url: 'http://localhost:9000/sse' },
      });
    });
  });
});
