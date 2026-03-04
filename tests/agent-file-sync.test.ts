import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import { AgentFileSync } from '../src/git/agent-file-sync.js';
import { Logger } from '@cadre/framework/core';
import * as fsUtils from '../src/util/fs.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('agent body content'),
  readdir: vi.fn().mockResolvedValue([]),
  symlink: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

const { mockRaw } = vi.hoisted(() => ({
  mockRaw: vi.fn().mockResolvedValue('/tmp/repo/.git/worktrees/issue-1'),
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({ raw: mockRaw })),
  default: vi.fn(() => ({ raw: mockRaw })),
}));

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

  describe('buildAgentCache', () => {
    it('is a no-op when agentDir is undefined', async () => {
      const sync = new AgentFileSync(undefined, 'copilot', mockLogger, '/tmp/state');
      await sync.buildAgentCache();
      expect(fsp.writeFile).not.toHaveBeenCalled();
    });

    it('is a no-op when stateDir is undefined', async () => {
      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger);
      await sync.buildAgentCache();
      expect(fsp.writeFile).not.toHaveBeenCalled();
    });

    it('is a no-op when agentDir does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      await sync.buildAgentCache();
      expect(fsp.writeFile).not.toHaveBeenCalled();
    });

    it('generates .agent.md files with frontmatter into cache for copilot', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.md']);
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('body');

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      await sync.buildAgentCache();

      expect(fsUtils.ensureDir).toHaveBeenCalledWith('/tmp/state/agents-cache-copilot');
      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toBe('/tmp/state/agents-cache-copilot/code-writer.agent.md');
      expect(writeCall[1]).toContain('tools: ["read", "edit", "search", "execute"]');
      expect(writeCall[1]).toContain('body');
    });

    it('generates .md files with frontmatter into cache for claude', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.md']);
      vi.mocked(fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('body');

      const sync = new AgentFileSync('/tmp/agents', 'claude', mockLogger, '/tmp/state');
      await sync.buildAgentCache();

      expect(fsUtils.ensureDir).toHaveBeenCalledWith('/tmp/state/agents-cache-claude');
      const writeCall = vi.mocked(fsp.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toBe('/tmp/state/agents-cache-claude/code-writer.md');
      expect(writeCall[1]).not.toContain('tools:');
      expect(writeCall[1]).toContain('body');
    });
  });

  describe('syncAgentFiles', () => {
    it('returns [] when stateDir/cacheDir is undefined', async () => {
      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger);
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);
      expect(result).toEqual([]);
    });

    it('returns [] when cache dir does not exist', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValueOnce(false);
      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);
      expect(result).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('does not exist'),
        expect.any(Object),
      );
    });

    it('creates symlinks for copilot backend', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.agent.md']);
      vi.mocked(fsp.lstat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      mockRaw.mockResolvedValueOnce('');

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('.github/agents/code-writer.agent.md');
      expect(fsp.symlink).toHaveBeenCalledWith(
        '/tmp/state/agents-cache-copilot/code-writer.agent.md',
        expect.stringContaining('.github/agents/code-writer.agent.md'),
      );
      expect(fsp.writeFile).not.toHaveBeenCalled();
    });

    it('creates symlinks for claude backend', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.md']);
      vi.mocked(fsp.lstat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      mockRaw.mockResolvedValueOnce('');

      const sync = new AgentFileSync('/tmp/agents', 'claude', mockLogger, '/tmp/state');
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('.claude/agents/code-writer.md');
      expect(fsp.symlink).toHaveBeenCalledWith(
        '/tmp/state/agents-cache-claude/code-writer.md',
        expect.stringContaining('.claude/agents/code-writer.md'),
      );
    });

    it('replaces existing symlinks', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.agent.md']);
      vi.mocked(fsp.lstat as ReturnType<typeof vi.fn>).mockResolvedValue({
        isSymbolicLink: () => true,
      } as any);
      mockRaw.mockResolvedValueOnce('');

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(fsp.unlink).toHaveBeenCalled();
      expect(fsp.symlink).toHaveBeenCalled();
    });

    it('skips regular files (target repo may own them)', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.agent.md']);
      vi.mocked(fsp.lstat as ReturnType<typeof vi.fn>).mockResolvedValue({
        isSymbolicLink: () => false,
      } as any);

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(result).toEqual([]);
      expect(fsp.symlink).not.toHaveBeenCalled();
    });

    it('excludes already-tracked destination paths from syncedRelPaths', async () => {
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      vi.mocked(fsp.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['code-writer.agent.md']);
      vi.mocked(fsp.lstat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      mockRaw.mockResolvedValueOnce('.github/agents/code-writer.agent.md');

      const sync = new AgentFileSync('/tmp/agents', 'copilot', mockLogger, '/tmp/state');
      const result = await sync.syncAgentFiles('/tmp/worktree', 1);

      expect(fsp.symlink).toHaveBeenCalled();
      expect(result).toHaveLength(0);
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
      await expect(sync.initCadreDir('/tmp/worktree', 1)).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Could not write worktree git exclude'),
        expect.any(Object),
      );
    });
  });
});
