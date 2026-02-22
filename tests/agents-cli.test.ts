import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';
import { registerAgentsCommand } from '../src/cli/agents.js';

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
  copilot: { agentDir: '/mock/agent-dir' },
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAgentsCommand(program);
  return program;
}

describe('AGENT_DEFINITIONS registry', () => {
  it('should contain exactly 12 entries', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(12);
  });

  it('should have all required fields for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.phase).toBe('number');
      expect(typeof def.phaseName).toBe('string');
      expect(def.phaseName.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
      expect(typeof def.hasStructuredOutput).toBe('boolean');
      expect(typeof def.templateFile).toBe('string');
      expect(def.templateFile.length).toBeGreaterThan(0);
    }
  });

  it('should have no duplicate agent names', () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(AGENT_DEFINITIONS.length);
  });
});

describe('agents validate CLI', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadConfig).mockResolvedValue(mockConfig as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should exit 0 and report success when all files exist and are non-empty', async () => {
    vi.mocked(statOrNull).mockResolvedValue({ size: 42 } as never);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`All ${AGENT_DEFINITIONS.length} agent files are valid`),
    );
  });

  it('should exit 1 and include "Missing:" when a file does not exist', async () => {
    vi.mocked(statOrNull).mockResolvedValue(null);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('Missing:');
  });

  it('should exit 1 and include "Empty:" when a file is empty', async () => {
    vi.mocked(statOrNull).mockResolvedValue({ size: 0 } as never);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(1);
    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('Empty:');
  });

  it('should report one issue per agent when all files are missing', async () => {
    vi.mocked(statOrNull).mockResolvedValue(null);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain(`${AGENT_DEFINITIONS.length} issue(s)`);
  });

  it('should suggest running scaffold when validation fails', async () => {
    vi.mocked(statOrNull).mockResolvedValue(null);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('cadre agents scaffold');
  });
});

describe('agents scaffold CLI', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('# template content' as never);
    // By default: templates exist, destination files do not
    vi.mocked(exists).mockImplementation(async (path: string) => {
      return (path as string).includes('templates');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write files for all agents to the agentDir', async () => {
    const program = makeProgram();
    await program.parseAsync(['agents', 'scaffold'], { from: 'user' });

    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    const [firstPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(firstPath).toMatch(/^\/mock\/agent-dir\//);
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
    vi.mocked(exists).mockResolvedValue(true); // templates and destinations exist

    const program = makeProgram();
    await program.parseAsync(['agents', 'scaffold', '--force'], { from: 'user' });

    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('overwrite'));
  });

  it('should scaffold only the named agent with --agent', async () => {
    const program = makeProgram();
    await program.parseAsync(['agents', 'scaffold', '--agent', 'issue-analyst'], { from: 'user' });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).toContain('issue-analyst');
  });

  it('should exit 1 for an unknown --agent name', async () => {
    const program = makeProgram();
    await program.parseAsync(['agents', 'scaffold', '--agent', 'no-such-agent'], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
