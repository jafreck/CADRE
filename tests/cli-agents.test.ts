import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAgentsCommand } from '../src/cli/agents.js';
import { AGENT_DEFINITIONS } from '../src/agents/definitions.js';

// Mock config loader
vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

// Mock fs utils
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  writeTextFile: vi.fn(),
  readFileOrNull: vi.fn(),
}));

import { loadConfig } from '../src/config/loader.js';
import { exists, writeTextFile, readFileOrNull } from '../src/util/fs.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockExists = vi.mocked(exists);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockReadFileOrNull = vi.mocked(readFileOrNull);

const fakeConfig = {
  repoPath: '/repo',
  copilot: { agentDir: '.github/agents' },
};

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit during tests
  registerAgentsCommand(program);
  return program;
}

describe('registerAgentsCommand', () => {
  it('should register an "agents" command on the program', () => {
    const program = makeProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
  });

  it('should register list, scaffold, and validate subcommands', () => {
    const program = makeProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents')!;
    const subNames = agentsCmd.commands.map((c) => c.name());
    expect(subNames).toContain('list');
    expect(subNames).toContain('scaffold');
    expect(subNames).toContain('validate');
  });

  it('should give each subcommand a description', () => {
    const program = makeProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents')!;
    for (const sub of agentsCmd.commands) {
      expect(sub.description(), `${sub.name()} should have a description`).toBeTruthy();
    }
  });

  it('should give the agents command a description', () => {
    const program = makeProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents')!;
    expect(agentsCmd.description()).toBeTruthy();
  });
});

describe('agents list', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadConfig.mockResolvedValue(fakeConfig as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print a line per agent definition', async () => {
    mockExists.mockResolvedValue(true);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'list']);
    expect(consoleSpy).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
  });

  it('should show ✓ for existing template files', async () => {
    mockExists.mockResolvedValue(true);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'list']);
    for (const call of consoleSpy.mock.calls) {
      expect(call[0]).toContain('✓');
    }
  });

  it('should show ✗ for missing template files', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'list']);
    for (const call of consoleSpy.mock.calls) {
      expect(call[0]).toContain('✗');
    }
  });

  it('should use absolute agentDir when config.copilot.agentDir is absolute', async () => {
    mockLoadConfig.mockResolvedValue({
      repoPath: '/repo',
      copilot: { agentDir: '/abs/agents' },
    } as never);
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'list']);
    // exists should be called with paths under /abs/agents
    const paths = mockExists.mock.calls.map(([p]) => p as string);
    expect(paths.every((p) => p.startsWith('/abs/agents'))).toBe(true);
  });

  it('should resolve relative agentDir relative to repoPath', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'list']);
    const paths = mockExists.mock.calls.map(([p]) => p as string);
    expect(paths.every((p) => p.startsWith('/repo/.github/agents'))).toBe(true);
  });
});

describe('agents scaffold', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadConfig.mockResolvedValue(fakeConfig as never);
    mockWriteTextFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should create all missing template files', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold']);
    expect(mockWriteTextFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
  });

  it('should skip existing template files without --force', async () => {
    mockExists.mockResolvedValue(true);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold']);
    expect(mockWriteTextFile).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    expect(logSpy.mock.calls[0][0]).toContain('skip');
  });

  it('should overwrite existing files with --force', async () => {
    mockExists.mockResolvedValue(true);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold', '--force']);
    expect(mockWriteTextFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    expect(logSpy.mock.calls[0][0]).toContain('overwrite');
  });

  it('should scaffold only the specified agent with --agent', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold', '--agent', 'code-writer']);
    expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
    const [filePath] = mockWriteTextFile.mock.calls[0];
    expect(filePath).toContain('code-writer.agent.md');
  });

  it('should log "create" when creating a new file', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold', '--agent', 'code-writer']);
    expect(logSpy.mock.calls[0][0]).toContain('create');
  });

  it('should write content containing the agent name', async () => {
    mockExists.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold', '--agent', 'code-writer']);
    const [, content] = mockWriteTextFile.mock.calls[0];
    expect(content).toContain('code-writer');
  });

  it('should exit 1 for unknown --agent name', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    // exitOverride is set, but process.exit is called directly in the handler
    await program.parseAsync(['node', 'cadre', 'agents', 'scaffold', '--agent', 'nonexistent-agent']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('agents validate', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadConfig.mockResolvedValue(fakeConfig as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should exit 0 and log success when all templates exist and are non-empty', async () => {
    mockReadFileOrNull.mockResolvedValue('# Agent content');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy.mock.calls[0][0]).toContain('valid');
    exitSpy.mockRestore();
  });

  it('should exit 1 when a template file is missing', async () => {
    mockReadFileOrNull.mockResolvedValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should exit 1 when a template file is empty', async () => {
    mockReadFileOrNull.mockResolvedValue('   ');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should report "missing" in error output for null files', async () => {
    mockReadFileOrNull.mockResolvedValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('missing');
    exitSpy.mockRestore();
  });

  it('should report "empty" in error output for blank files', async () => {
    mockReadFileOrNull.mockResolvedValue('  \n  ');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allErrors).toContain('empty');
    exitSpy.mockRestore();
  });

  it('should report the count of valid templates in success message', async () => {
    mockReadFileOrNull.mockResolvedValue('# content');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const program = makeProgram();
    await program.parseAsync(['node', 'cadre', 'agents', 'validate']);
    const successMsg = logSpy.mock.calls[0][0] as string;
    expect(successMsg).toContain(String(AGENT_DEFINITIONS.length));
    exitSpy.mockRestore();
  });
});
