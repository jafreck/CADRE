import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAgentsCommand } from '../src/cli/agents.js';

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    agent: {
      backend: 'copilot',
      copilot: { agentDir: '/fake/agents' },
      claude: { agentDir: '/fake/agents' },
    },
    copilot: { agentDir: '/fake/agents' },
  }),
  applyOverrides: vi.fn((c: unknown) => c),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: {
    validateAgentFiles: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../src/cli/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cli/agents.js')>();
  return {
    ...actual,
    refreshAgentsFromTemplates: vi.fn().mockResolvedValue(10),
    scaffoldMissingAgents: vi.fn().mockResolvedValue(1),
  };
});

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: true }),
    status: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue(undefined),
    pruneWorktrees: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockResolvedValue(true),
    report: vi.fn().mockResolvedValue(undefined),
  })),
}));

/**
 * Build a minimal program that mirrors what src/index.ts does:
 * register the built-in commands and then call registerAgentsCommand.
 */
function buildProgram(): Command {
  const program = new Command();
  program.name('cadre').exitOverride();

  program
    .command('run')
    .description('Execute the CADRE pipeline for configured issues')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-r, --resume', 'Resume from last checkpoint')
    .option('-d, --dry-run', 'Validate configuration without executing')
    .option('-i, --issue <numbers...>', 'Override: process specific issue numbers')
    .option('-p, --parallel <n>', 'Override: max parallel issues', parseInt)
    .option('--no-pr', 'Skip PR creation')
    .option('--respond-to-reviews', 'Respond to pull request reviews instead of processing new issues')
    .option('--no-autoscaffold', 'Skip auto-scaffolding of missing agent files')
    .option('--dag', 'Enable DAG-based dependency ordering of issues (overrides config)');
  program.command('status').description('Show current pipeline status');
  program.command('reset').description('Reset pipeline state');
  program.command('worktrees').description('List or prune CADRE-managed worktrees');

  registerAgentsCommand(program);

  return program;
}

describe('src/index.ts command registration', () => {
  it('should register the agents command at the top level', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('agents');
  });

  it('should preserve existing commands alongside agents', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('run');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('reset');
    expect(commandNames).toContain('worktrees');
  });

  it('should register agents with list subcommand', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
  });

  it('should register agents with validate subcommand', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('validate');
  });

  it('should register exactly list and validate under agents', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name()).sort();
    expect(subNames).toEqual(['list', 'validate']);
  });

  it('should register --no-pr option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--no-pr');
  });

  it('should default pr to true when --no-pr is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().pr).toBe(true);
  });

  it('should set pr to false when --no-pr is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--no-pr']);
    expect(runCmd.opts().pr).toBe(false);
  });

  it('noPr value (!opts.pr) should be true when --no-pr is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--no-pr']);
    const opts = runCmd.opts();
    expect(!opts.pr).toBe(true);
  });

  it('noPr value (!opts.pr) should be false when --no-pr is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    const opts = runCmd.opts();
    expect(!opts.pr).toBe(false);
  });

  it('should register --respond-to-reviews option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--respond-to-reviews');
  });

  it('should set respondToReviews to true when --respond-to-reviews is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--respond-to-reviews']);
    expect(runCmd.opts().respondToReviews).toBe(true);
  });

  it('should not set respondToReviews when --respond-to-reviews is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().respondToReviews).toBeUndefined();
  });

  it('should register --dag option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--dag');
  });

  it('should set dag to true when --dag is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--dag']);
    expect(runCmd.opts().dag).toBe(true);
  });

  it('should not set dag when --dag is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().dag).toBeUndefined();
  });

  it('should accept --dag combined with --issue', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--dag', '--issue', '1', '2']);
    const opts = runCmd.opts();
    expect(opts.dag).toBe(true);
    expect(opts.issue).toEqual(['1', '2']);
  });

  it('should accept --respond-to-reviews combined with --issue', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--respond-to-reviews', '--issue', '42', '97']);
    const opts = runCmd.opts();
    expect(opts.respondToReviews).toBe(true);
    expect(opts.issue).toEqual(['42', '97']);
  });

  it('(a) should register --no-autoscaffold option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    const optionNames = runCmd.options.map((o) => o.long);
    expect(optionNames).toContain('--no-autoscaffold');
  });

  it('(b) should default autoscaffold to true when --no-autoscaffold is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().autoscaffold).toBe(true);
  });

  it('(c) should set autoscaffold to false when --no-autoscaffold is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--no-autoscaffold']);
    expect(runCmd.opts().autoscaffold).toBe(false);
  });
});

const originalArgv = process.argv;

describe('run command autoscaffold runtime behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('(b) should call scaffoldMissingAgents, log notice, and not exit 1 when all issues are scaffoldable', async () => {
    process.argv = ['node', 'cadre', 'run'];
    vi.resetModules();
    const { AgentLauncher } = await import('../src/core/agent-launcher.js');
    const agentsMod = await import('../src/cli/agents.js');
    vi.mocked(AgentLauncher.validateAgentFiles)
      .mockResolvedValueOnce(['Missing: some-agent'])
      .mockResolvedValueOnce([]);
    vi.mocked(agentsMod.scaffoldMissingAgents).mockResolvedValueOnce(1);
    await import('../src/index.js').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(agentsMod.scaffoldMissingAgents).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-scaffolded 1 missing agent file(s)'),
    );
    expect(process.exit).not.toHaveBeenCalledWith(1);
  });

  it('(c) should skip scaffoldMissingAgents and exit 1 when --no-autoscaffold is provided', async () => {
    process.argv = ['node', 'cadre', 'run', '--no-autoscaffold'];
    vi.resetModules();
    const { AgentLauncher } = await import('../src/core/agent-launcher.js');
    const agentsMod = await import('../src/cli/agents.js');
    vi.mocked(AgentLauncher.validateAgentFiles).mockResolvedValueOnce(['Missing: some-agent']);
    await import('../src/index.js').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(agentsMod.scaffoldMissingAgents).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('cadre run autoscaffold behavior', () => {
  const originalArgv = process.argv;

  let validateAgentFilesMock: ReturnType<typeof vi.fn>;
  let scaffoldMissingAgentsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    validateAgentFilesMock = vi.fn();
    scaffoldMissingAgentsMock = vi.fn();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadRunWith(args: string[]) {
    process.argv = ['node', 'index.js', 'run', ...args];
    vi.resetModules();
    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({
        copilot: { agentDir: '/agent-dir' },
        agent: {
          backend: 'copilot',
          copilot: { agentDir: '/agent-dir' },
          claude: { agentDir: '/agent-dir' },
        },
      }),
      applyOverrides: vi.fn((c: unknown) => c),
    }));
    vi.doMock('../src/core/runtime.js', () => ({
      CadreRuntime: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    }));
    vi.doMock('../src/core/agent-launcher.js', () => ({
      AgentLauncher: { validateAgentFiles: validateAgentFilesMock },
    }));
    vi.doMock('../src/cli/agents.js', () => ({
      registerAgentsCommand: vi.fn(),
      refreshAgentsFromTemplates: vi.fn().mockResolvedValue(10),
      scaffoldMissingAgents: scaffoldMissingAgentsMock,
    }));
    await import('../src/index.js').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it('(b) autoscaffold: calls scaffoldMissingAgents, logs notice, and does not exit 1 when all issues resolve', async () => {
    validateAgentFilesMock
      .mockResolvedValueOnce(['  ❌ Missing: /agent-dir/some-agent.md'])
      .mockResolvedValueOnce([]);
    scaffoldMissingAgentsMock.mockResolvedValue(1);

    await loadRunWith([]);

    expect(scaffoldMissingAgentsMock).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-scaffolded 1 missing agent file(s)'),
    );
    expect(process.exit).not.toHaveBeenCalledWith(1);
  });

  it('(c) --no-autoscaffold: does not call scaffoldMissingAgents and exits 1', async () => {
    validateAgentFilesMock.mockResolvedValue(['  ❌ Missing: /agent-dir/some-agent.md']);
    scaffoldMissingAgentsMock.mockResolvedValue(0);

    await loadRunWith(['--no-autoscaffold']);

    expect(scaffoldMissingAgentsMock).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('cadre run --dag flag runtime behavior', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadRunWithDag(args: string[]) {
    process.argv = ['node', 'index.js', 'run', ...args];
    vi.resetModules();

    let capturedConfig: Record<string, unknown> | null = null;
    const baseConfig = {
      copilot: { agentDir: '/agent-dir' },
      agent: {
        backend: 'copilot',
        copilot: { agentDir: '/agent-dir' },
        claude: { agentDir: '/agent-dir' },
      },
      dag: { enabled: false },
    };

    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({ ...baseConfig }),
      applyOverrides: vi.fn((c: unknown) => c),
    }));
    vi.doMock('../src/core/runtime.js', () => ({
      CadreRuntime: vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
        capturedConfig = cfg;
        return { run: vi.fn().mockResolvedValue({ success: true }) };
      }),
    }));
    vi.doMock('../src/core/agent-launcher.js', () => ({
      AgentLauncher: { validateAgentFiles: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock('../src/cli/agents.js', () => ({
      registerAgentsCommand: vi.fn(),
      refreshAgentsFromTemplates: vi.fn().mockResolvedValue(0),
      scaffoldMissingAgents: vi.fn().mockResolvedValue(0),
    }));

    await import('../src/index.js').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    return capturedConfig as Record<string, unknown> | null;
  }

  it('should set config.dag.enabled to true when --dag flag is provided', async () => {
    const config = await loadRunWithDag(['--dag']);
    expect(config).not.toBeNull();
    expect((config as Record<string, unknown> & { dag?: { enabled: boolean } })?.dag?.enabled).toBe(true);
  });

  it('should not change dag.enabled when --dag flag is not provided', async () => {
    const config = await loadRunWithDag([]);
    expect(config).not.toBeNull();
    // dag.enabled should remain false (the config file value)
    expect((config as Record<string, unknown> & { dag?: { enabled: boolean } })?.dag?.enabled).toBe(false);
  });
});

describe('cadre run typed error handling', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadRunWithErrorFactory(errorFactory: () => Promise<unknown>) {
    process.argv = ['node', 'index.js', 'run'];
    vi.resetModules();
    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({
        agent: {
          backend: 'copilot',
          copilot: { agentDir: '/agent-dir' },
          claude: { agentDir: '/agent-dir' },
        },
      }),
      applyOverrides: vi.fn((c: unknown) => c),
    }));
    vi.doMock('../src/core/runtime.js', () => ({
      CadreRuntime: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockImplementation(async () => { throw await errorFactory(); }),
      })),
    }));
    vi.doMock('../src/core/agent-launcher.js', () => ({
      AgentLauncher: { validateAgentFiles: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock('../src/cli/agents.js', () => ({
      registerAgentsCommand: vi.fn(),
      refreshAgentsFromTemplates: vi.fn().mockResolvedValue(0),
      scaffoldMissingAgents: vi.fn().mockResolvedValue(0),
    }));
    await import('../src/index.js').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it('should print conflict map to stderr and exit 1 when StaleStateError is thrown', async () => {
    await loadRunWithErrorFactory(async () => {
      const { StaleStateError } = await import('../src/errors.js');
      const conflicts = new Map([
        [42, [{ kind: 'worktree' as const, description: 'Worktree already exists at /path/worktree' }]],
      ]);
      return new StaleStateError('stale state detected', { hasConflicts: true, conflicts });
    });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Issue #42'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('worktree'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Worktree already exists'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should exit with error.exitCode (130) and not print extra error when RuntimeInterruptedError(SIGINT) is thrown', async () => {
    await loadRunWithErrorFactory(async () => {
      const { RuntimeInterruptedError } = await import('../src/errors.js');
      return new RuntimeInterruptedError('interrupted by SIGINT', 'SIGINT', 130);
    });

    expect(process.exit).toHaveBeenCalledWith(130);
    // Should not print any additional error message for this error type
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Error:'));
  });
});
