import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAgentsCommand, scaffoldMissingAgentFiles } from '../src/cli/agents.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  statOrNull: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

import { loadConfig } from '../src/config/loader.js';
import { exists, statOrNull } from '../src/util/fs.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const mockConfig = {
  copilot: { agentDir: '/mock/agents' },
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAgentsCommand(program);
  return program;
}

describe('registerAgentsCommand', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadConfig).mockResolvedValue(mockConfig as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agents list', () => {
    it('should print a header row', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      const calls = logSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((line) => line.includes('Agent'))).toBe(true);
    });

    it('should print a row for each agent definition', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      // Header + separator + one row per agent
      expect(logSpy).toHaveBeenCalledTimes(2 + AGENT_DEFINITIONS.length);
    });

    it('should show ✅ for existing agent files', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      const rows = logSpy.mock.calls.slice(2).map((c) => c[0] as string);
      expect(rows.every((row) => row.includes('✅'))).toBe(true);
    });

    it('should show ❌ for missing agent files', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      const rows = logSpy.mock.calls.slice(2).map((c) => c[0] as string);
      expect(rows.every((row) => row.includes('❌'))).toBe(true);
    });

    it('should use the default config path cadre.config.json', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      expect(loadConfig).toHaveBeenCalledWith('cadre.config.json');
    });

    it('should use the provided -c config path', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const program = makeProgram();
      await program.parseAsync(['agents', 'list', '-c', 'custom.config.json'], { from: 'user' });

      expect(loadConfig).toHaveBeenCalledWith('custom.config.json');
    });

    it('should exit 1 and print error when loadConfig fails', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('config not found'));

      const program = makeProgram();
      await program.parseAsync(['agents', 'list'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('config not found'));
    });
  });

  describe('agents scaffold', () => {
    beforeEach(() => {
      vi.mocked(readFile).mockResolvedValue('# template content' as never);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      // templates exist, destination files do not
      vi.mocked(exists).mockImplementation(async (path: string) => {
        return (path as string).includes('templates');
      });
    });

    it('should create files for all agents when no --agent flag', async () => {
      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

      expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    });

    it('should write agent files to agentDir by default', async () => {
      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

      const [firstPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
      expect(firstPath).toMatch(/^\/mock\/agents\//);
      expect(firstPath).toMatch(/\.md$/);
    });

    it('should skip existing files without --force', async () => {
      vi.mocked(exists).mockResolvedValue(true); // all files exist

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

      expect(writeFile).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skip'));
    });

    it('should overwrite existing files with --force', async () => {
      vi.mocked(exists).mockImplementation(async (path: string) => {
        // Templates exist, destination files also exist
        return true;
      });

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--force'], { from: 'user' });

      expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('overwrite'));
    });

    it('should scaffold only the named agent with --agent', async () => {
      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--agent', 'code-writer'], { from: 'user' });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
      expect(writtenPath).toContain('code-writer');
    });

    it('should exit 1 for an unknown --agent name', async () => {
      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--agent', 'nonexistent-agent'], {
        from: 'user',
      });

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown agent'));
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should write to <agentDir>/<name>/CLAUDE.md with --backend claude', async () => {
      const agentName = AGENT_DEFINITIONS[0].name;

      const program = makeProgram();
      await program.parseAsync(
        ['agents', 'scaffold', '--agent', agentName, '--backend', 'claude'],
        { from: 'user' },
      );

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
      expect(writtenPath).toBe(`/mock/agents/${agentName}/CLAUDE.md`);
    });

    it('should use default <agentDir>/<name>.agent.md path for copilot backend (no --backend flag)', async () => {
      const agentName = AGENT_DEFINITIONS[0].name;

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--agent', agentName], { from: 'user' });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
      expect(writtenPath).toBe(`/mock/agents/${agentName}.agent.md`);
    });

    it('should warn and skip when template file is not found', async () => {
      vi.mocked(exists).mockResolvedValue(false); // templates missing too

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

      expect(writeFile).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Template not found'));
    });

    it('should create destination directory with mkdir', async () => {
      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--agent', 'code-writer'], { from: 'user' });

      expect(mkdir).toHaveBeenCalledWith('/mock/agents', { recursive: true });
    });

    it('should resolve template dir using ../agents/templates (not ../../src/agents/templates)', async () => {
      const capturedPaths: string[] = [];
      vi.mocked(exists).mockImplementation(async (path: string) => {
        capturedPaths.push(path as string);
        return (path as string).includes('templates');
      });

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold', '--agent', 'code-writer'], { from: 'user' });

      const templatePaths = capturedPaths.filter((p) => p.includes('templates'));
      expect(templatePaths.length).toBeGreaterThan(0);
      for (const p of templatePaths) {
        // The old (broken) dist branch used ../../src/agents/templates; verify that pattern is absent
        expect(p).not.toMatch(/[/\\]\.\.[/\\]\.\.[/\\]src[/\\]/);
      }
    });

    it('should exit 1 when loadConfig fails', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('bad config'));

      const program = makeProgram();
      await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('agents validate', () => {
    it('should exit 0 when all agent files exist and are non-empty', async () => {
      vi.mocked(statOrNull).mockResolvedValue({ size: 100 } as never);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`All ${AGENT_DEFINITIONS.length} agent files are valid`),
      );
    });

    it('should exit 1 when an agent file is missing', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'));
    });

    it('should exit 1 when an agent file is empty', async () => {
      vi.mocked(statOrNull).mockResolvedValue({ size: 0 } as never);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed'));
    });

    it('should list missing files in the error output', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allErrors).toContain('Missing:');
    });

    it('should list empty files in the error output', async () => {
      vi.mocked(statOrNull).mockResolvedValue({ size: 0 } as never);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allErrors).toContain('Empty:');
    });

    it('should suggest running scaffold in the error output', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allErrors).toContain('cadre agents scaffold');
    });

    it('should report one issue per agent when all files are missing', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allErrors).toContain(`${AGENT_DEFINITIONS.length} issue(s)`);
    });

    it('should use the default config path cadre.config.json', async () => {
      vi.mocked(statOrNull).mockResolvedValue({ size: 100 } as never);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(loadConfig).toHaveBeenCalledWith('cadre.config.json');
    });

    it('should exit 1 when loadConfig fails', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('bad config'));

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should validate files at the default path <agentDir>/<name>.md', async () => {
      const firstAgent = AGENT_DEFINITIONS[0];
      vi.mocked(statOrNull).mockResolvedValue({ size: 100 } as never);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      expect(statOrNull).toHaveBeenCalledWith(`/mock/agents/${firstAgent.name}.agent.md`);
    });
  });
});

describe('scaffoldMissingAgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue('# template content' as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    // Templates exist, destination files do not
    vi.mocked(exists).mockImplementation(async (path: string) => {
      return (path as string).includes('templates');
    });
  });

  it('should create all missing agent files and return their paths', async () => {
    const created = await scaffoldMissingAgentFiles('/mock/agents', 'copilot');
    expect(created).toHaveLength(AGENT_DEFINITIONS.length);
    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
  });

  it('should write .agent.md files for the copilot backend', async () => {
    const created = await scaffoldMissingAgentFiles('/mock/agents', 'copilot');
    expect(created.every((p) => p.endsWith('.agent.md'))).toBe(true);
    expect(created.every((p) => p.startsWith('/mock/agents/'))).toBe(true);
  });

  it('should skip files that already exist', async () => {
    vi.mocked(exists).mockResolvedValue(true); // all dest files already exist
    const created = await scaffoldMissingAgentFiles('/mock/agents', 'copilot');
    expect(created).toHaveLength(0);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should return an empty array when all files already exist', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    const result = await scaffoldMissingAgentFiles('/mock/agents', 'copilot');
    expect(result).toEqual([]);
  });

  it('should throw when a template file is missing', async () => {
    // Neither dest nor template exist
    vi.mocked(exists).mockResolvedValue(false);
    await expect(scaffoldMissingAgentFiles('/mock/agents', 'copilot')).rejects.toThrow(
      /Template not found/,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should write CLAUDE.md paths for the claude backend', async () => {
    const agentName = AGENT_DEFINITIONS[0].name;
    // Only the first agent dest is missing; all others already exist
    vi.mocked(exists).mockImplementation(async (path: string) => {
      return (path as string).includes('templates') || !path.includes(agentName);
    });
    const created = await scaffoldMissingAgentFiles('/mock/agents', 'claude');
    expect(created).toHaveLength(1);
    expect(created[0]).toBe(`/mock/agents/${agentName}/CLAUDE.md`);
  });

  it('should call mkdir with recursive option before writing each file', async () => {
    await scaffoldMissingAgentFiles('/mock/agents', 'copilot');
    expect(mkdir).toHaveBeenCalledWith('/mock/agents', { recursive: true });
  });
});
