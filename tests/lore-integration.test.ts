import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoreIndexBuilder, resolveLoreConfig, type LoreConfig } from '../src/core/lore/lore-index-builder.js';
import { LoreMcpConfigWriter } from '../src/core/lore/lore-mcp-config.js';
import type { CadreConfig } from '../src/config/schema.js';

// ── Mocks ──

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { readFile, writeFile } from 'node:fs/promises';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const defaultLoreConfig: LoreConfig = {
  enabled: true,
  command: 'lore',
  indexArgs: [],
  serveArgs: ['mcp'],
  indexTimeout: 120_000,
};

// ── resolveLoreConfig ──

describe('resolveLoreConfig', () => {
  it('should return disabled config when lore is undefined', () => {
    const config = { lore: undefined } as unknown as CadreConfig;
    const result = resolveLoreConfig(config);
    expect(result.enabled).toBe(false);
    expect(result.command).toBe('lore');
  });

  it('should resolve explicit config values', () => {
    const config = {
      lore: {
        enabled: true,
        command: 'my-lore',
        indexArgs: ['--deep'],
        serveArgs: ['serve', '--port', '9999'],
        indexTimeout: 60_000,
      },
    } as unknown as CadreConfig;
    const result = resolveLoreConfig(config);
    expect(result).toEqual({
      enabled: true,
      command: 'my-lore',
      indexArgs: ['--deep'],
      serveArgs: ['serve', '--port', '9999'],
      indexTimeout: 60_000,
    });
  });

  it('should apply defaults for missing fields', () => {
    const config = {
      lore: { enabled: true },
    } as unknown as CadreConfig;
    const result = resolveLoreConfig(config);
    expect(result.command).toBe('lore');
    expect(result.indexArgs).toEqual([]);
    expect(result.serveArgs).toEqual(['mcp']);
    expect(result.indexTimeout).toBe(120_000);
  });
});

// ── LoreIndexBuilder ──

describe('LoreIndexBuilder', () => {
  let builder: LoreIndexBuilder;

  beforeEach(() => {
    vi.resetAllMocks();
    builder = new LoreIndexBuilder(defaultLoreConfig, mockLogger as any);
  });

  it('should return false when lore is disabled', async () => {
    const disabledBuilder = new LoreIndexBuilder(
      { ...defaultLoreConfig, enabled: false },
      mockLogger as any,
    );
    const result = await disabledBuilder.buildIndex('/tmp/worktree', 42);
    expect(result).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('should run lore index command and return true on success', async () => {
    vi.mocked(exec).mockResolvedValue({
      exitCode: 0,
      stdout: 'Indexed 150 files',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    const result = await builder.buildIndex('/tmp/worktree', 42);

    expect(result).toBe(true);
    expect(exec).toHaveBeenCalledWith(
      'lore',
      ['index', '--root', '/tmp/worktree', '--db', '/tmp/worktree/.cadre/lore.db'],
      { cwd: '/tmp/worktree', timeout: 120_000 },
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Building Lore index for worktree',
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('should pass extra indexArgs to the command', async () => {
    const customBuilder = new LoreIndexBuilder(
      { ...defaultLoreConfig, indexArgs: ['--deep', '--lang', 'typescript'] },
      mockLogger as any,
    );
    vi.mocked(exec).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    await customBuilder.buildIndex('/tmp/worktree', 7);

    expect(exec).toHaveBeenCalledWith(
      'lore',
      ['index', '--root', '/tmp/worktree', '--db', '/tmp/worktree/.cadre/lore.db', '--deep', '--lang', 'typescript'],
      expect.any(Object),
    );
  });

  it('should return false and warn on non-zero exit code', async () => {
    vi.mocked(exec).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'index failed: no files found',
      signal: null,
      timedOut: false,
    });

    const result = await builder.buildIndex('/tmp/worktree', 42);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Lore index build failed'),
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('should return false and warn on exception', async () => {
    vi.mocked(exec).mockRejectedValue(new Error('command not found'));

    const result = await builder.buildIndex('/tmp/worktree', 42);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Lore index build error'),
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('should use custom command from config', async () => {
    const customBuilder = new LoreIndexBuilder(
      { ...defaultLoreConfig, command: '/usr/local/bin/my-lore' },
      mockLogger as any,
    );
    vi.mocked(exec).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    await customBuilder.buildIndex('/tmp/worktree', 1);

    expect(exec).toHaveBeenCalledWith(
      '/usr/local/bin/my-lore',
      expect.any(Array),
      expect.any(Object),
    );
  });
});

// ── LoreMcpConfigWriter ──

describe('LoreMcpConfigWriter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(exists).mockResolvedValue(false);
  });

  describe('Claude backend', () => {
    let writer: LoreMcpConfigWriter;

    beforeEach(() => {
      writer = new LoreMcpConfigWriter(defaultLoreConfig, 'claude', mockLogger as any);
    });

    it('should be a no-op when lore is disabled', async () => {
      const disabledWriter = new LoreMcpConfigWriter(
        { ...defaultLoreConfig, enabled: false },
        'claude',
        mockLogger as any,
      );
      await disabledWriter.writeMcpConfig('/tmp/worktree', 42);
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should write .claude/settings.local.json with lore MCP entry', async () => {
      await writer.writeMcpConfig('/tmp/worktree', 42);

      expect(writeFile).toHaveBeenCalledWith(
        '/tmp/worktree/.claude/settings.local.json',
        expect.any(String),
        'utf-8',
      );

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.mcpServers.lore).toEqual({
        command: 'lore',
        args: ['mcp', '--db', '/tmp/worktree/.cadre/lore.db'],
      });
    });

    it('should merge into existing settings file', async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        mcpServers: { github: { command: 'github-mcp-server', args: ['stdio'] } },
        otherSetting: true,
      }));

      await writer.writeMcpConfig('/tmp/worktree', 42);

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.mcpServers.github).toEqual({
        command: 'github-mcp-server',
        args: ['stdio'],
      });
      expect(written.mcpServers.lore).toEqual({
        command: 'lore',
        args: ['mcp', '--db', '/tmp/worktree/.cadre/lore.db'],
      });
      expect(written.otherSetting).toBe(true);
    });
  });

  describe('Copilot backend', () => {
    let writer: LoreMcpConfigWriter;

    beforeEach(() => {
      writer = new LoreMcpConfigWriter(defaultLoreConfig, 'copilot', mockLogger as any);
    });

    it('should write .github/copilot/mcp.json with lore MCP entry', async () => {
      await writer.writeMcpConfig('/tmp/worktree', 42);

      expect(writeFile).toHaveBeenCalledWith(
        '/tmp/worktree/.github/copilot/mcp.json',
        expect.any(String),
        'utf-8',
      );

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.mcpServers.lore).toEqual({
        command: 'lore',
        args: ['mcp', '--db', '/tmp/worktree/.cadre/lore.db'],
      });
    });

    it('should merge into existing copilot mcp.json', async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        mcpServers: { other: { command: 'other-server', args: [] } },
      }));

      await writer.writeMcpConfig('/tmp/worktree', 7);

      const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(written.mcpServers.other).toEqual({
        command: 'other-server',
        args: [],
      });
      expect(written.mcpServers.lore).toBeDefined();
    });
  });

  it('should include custom serveArgs in the MCP entry', async () => {
    const customConfig: LoreConfig = {
      ...defaultLoreConfig,
      serveArgs: ['serve', '--port', '8080'],
    };
    const writer = new LoreMcpConfigWriter(customConfig, 'claude', mockLogger as any);

    await writer.writeMcpConfig('/tmp/worktree', 1);

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
    expect(written.mcpServers.lore.args).toEqual([
      'serve', '--port', '8080', '--db', '/tmp/worktree/.cadre/lore.db',
    ]);
  });
});
