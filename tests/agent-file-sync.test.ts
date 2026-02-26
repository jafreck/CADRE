import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import { AgentFileSync } from '../src/git/agent-file-sync.js';
import { Logger } from '../src/logging/logger.js';
import * as fsUtils from '../src/util/fs.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('agent body content'),
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn().mockResolvedValue('/tmp/repo/.git/worktrees/issue-1'),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(true),
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/agents/types.js', () => ({
  AGENT_DEFINITIONS: [
    {
      name: 'code-writer',
      description: 'Implements tasks from the plan.',
      phase: 3,
      phaseName: 'Implementation',
      hasStructuredOutput: false,
      templateFile: 'code-writer.md',
    },
  ],
}));

describe('AgentFileSync', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
  });

  describe('syncAgentFiles', () => {
    it('returns [] when agentDir is undefined', async () => {
      const sync = new AgentFileSync(undefined, 'copilot', mockLogger);
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);
      expect(result).toEqual([]);
    });

    it('returns [] and logs when agentDir does not exist on disk', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger);
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);
      expect(result).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('does not exist'),
        expect.any(Object),
      );
    });

    it('syncs .agent.md files for copilot backend', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.md']);
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('body');

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger);
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('.github/agents/code-writer.agent.md');
      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toContain('.github/agents/code-writer.agent.md');
      expect(writeCall[1]).toContain('tools: ["read", "edit", "search", "execute"]');
    });

    it('syncs .md files for claude backend', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.md']);
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('body');

      const sync = new AgentFileSync('/tmp/agents', 'claude', mockLogger);
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('.claude/agents/code-writer.md');
      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toContain('.claude/agents/code-writer.md');
      // Claude frontmatter should NOT include tools line
      expect(writeCall[1]).not.toContain('tools:');
    });
  });

  describe('initCadreDir', () => {
    it('creates .cadre/ and .cadre/tasks/ directories', async () => {
      const sync = new AgentFileSync(undefined, 'copilot', mockLogger);
      await sync.initCadreDir('/tmp/worktree', 1);

      expect(fsUtils.ensureDir).toHaveBeenCalledWith('/tmp/worktree/.cadre');
      expect(fsUtils.ensureDir).toHaveBeenCalledWith('/tmp/worktree/.cadre/tasks');
    });

    it('writes correct exclude entries for copilot backend', async () => {
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
      const sync = new AgentFileSync(undefined, 'copilot', mockLogger);
      await sync.initCadreDir('/tmp/worktree', 1);

      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[1]).toContain('.cadre/');
      expect(writeCall[1]).toContain('.github/agents/');
    });

    it('writes correct exclude entries for claude backend', async () => {
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');
      const sync = new AgentFileSync(undefined, 'claude', mockLogger);
      await sync.initCadreDir('/tmp/worktree', 1);

      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[1]).toContain('.cadre/');
      expect(writeCall[1]).toContain('.claude/agents/');
    });

    it('is non-fatal when git-dir lookup fails', async () => {
      const { simpleGit } = await import('simple-git');
      vi.mocked(simpleGit).mockReturnValueOnce({
        raw: vi.fn().mockRejectedValue(new Error('not a git repo')),
      } as any);

      const sync = new AgentFileSync(undefined, 'copilot', mockLogger);
      // Should not throw
      await expect(sync.initCadreDir('/tmp/worktree', 1)).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Could not write worktree git exclude'),
        expect.any(Object),
      );
    });
  });
});
