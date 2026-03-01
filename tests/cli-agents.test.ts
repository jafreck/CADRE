import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAgentsCommand } from '../src/cli/agents.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';

vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  statOrNull: vi.fn(),
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

const mockConfig = {
  copilot: { agentDir: '/mock/agents' },
  agent: {
    backend: 'copilot',
    copilot: { agentDir: '/mock/agents' },
    claude: { agentDir: '/mock/claude/agents' },
  },
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
  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

    it('should suggest re-running cadre run in the error output', async () => {
      vi.mocked(statOrNull).mockResolvedValue(null);

      const program = makeProgram();
      await program.parseAsync(['agents', 'validate'], { from: 'user' });

      const allErrors = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(allErrors).toContain('cadre run');
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

      expect(statOrNull).toHaveBeenCalledWith(`/mock/agents/${firstAgent.name}.md`);
    });
  });
});
