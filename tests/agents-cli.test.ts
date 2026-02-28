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
import { scaffoldMissingAgents, refreshAgentsFromTemplates } from '../src/cli/agents.js';
// Note: scaffoldMissingAgents and refreshAgentsFromTemplates are exported for programmatic use by 'cadre run'

const mockConfig = {
  copilot: { agentDir: '/mock/agent-dir' },
  agent: {
    backend: 'copilot',
    copilot: { cliCommand: 'copilot', agentDir: '/mock/agent-dir' },
    claude: { cliCommand: 'claude', agentDir: '.claude/agents' },
  },
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerAgentsCommand(program);
  return program;
}

describe('AGENT_DEFINITIONS registry', () => {
  it('should contain exactly 14 entries', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(14);
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

  it('should suggest re-running cadre run when validation fails', async () => {
    vi.mocked(statOrNull).mockResolvedValue(null);

    const program = makeProgram();
    await program.parseAsync(['agents', 'validate'], { from: 'user' });

    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('cadre run');
  });
});

describe('refreshAgentsFromTemplates helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('# template content' as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should overwrite existing destination files (overwrite=true)', async () => {
    // templates exist AND destinations also exist → should still write
    vi.mocked(exists).mockResolvedValue(true);

    const count = await refreshAgentsFromTemplates('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(AGENT_DEFINITIONS.length);
    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
  });

  it('should return count of files written', async () => {
    vi.mocked(exists).mockResolvedValue(true);

    const count = await refreshAgentsFromTemplates('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(AGENT_DEFINITIONS.length);
  });

  it('should write {agent.name}.md filenames', async () => {
    vi.mocked(exists).mockResolvedValue(true);

    await refreshAgentsFromTemplates('/mock/agent-dir', '/mock/templates');

    const writtenPaths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    for (const p of writtenPaths) {
      expect(p).toMatch(/\/mock\/agent-dir\/.+\.md$/);
    }
  });

  it('should skip files when template is missing', async () => {
    // nothing exists (no templates) → nothing to write
    vi.mocked(exists).mockResolvedValue(false);

    const count = await refreshAgentsFromTemplates('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should write correct content from template', async () => {
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readFile).mockResolvedValue('# my agent template' as never);

    await refreshAgentsFromTemplates('/mock/agent-dir', '/mock/templates');

    const writtenContents = vi.mocked(writeFile).mock.calls.map((c) => c[1] as string);
    expect(writtenContents.every((c) => c === '# my agent template')).toBe(true);
  });
});

describe('scaffoldMissingAgents helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('# template content' as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 0 and skip all files when all destination files already exist', async () => {
    // templates exist, destination files also exist → all skipped
    vi.mocked(exists).mockResolvedValue(true);

    const count = await scaffoldMissingAgents('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should write missing files and return correct count', async () => {
    // templates exist, destinations do not
    vi.mocked(exists).mockImplementation(async (path: string) => {
      return (path as string).includes('templates');
    });

    const count = await scaffoldMissingAgents('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(AGENT_DEFINITIONS.length);
    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
  });

  it('should write ${agent.name}.md filenames', async () => {
    vi.mocked(exists).mockImplementation(async (path: string) => {
      return (path as string).includes('templates');
    });

    await scaffoldMissingAgents('/mock/agent-dir', '/mock/templates');

    const writtenPaths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    for (const p of writtenPaths) {
      expect(p).toMatch(/\/mock\/agent-dir\/.+\.md$/);
    }
  });

  it('should skip files when template is missing', async () => {
    // nothing exists (no templates, no destinations)
    vi.mocked(exists).mockResolvedValue(false);

    const count = await scaffoldMissingAgents('/mock/agent-dir', '/mock/templates');

    expect(count).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
