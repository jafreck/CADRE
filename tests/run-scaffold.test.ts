import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScaffold } from '../src/cli/agents.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';

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

import { exists } from '../src/util/fs.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const AGENT_DIR = '/test/agents';

describe('runScaffold', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readFile).mockResolvedValue('# template' as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    // templates exist, destinations do not
    vi.mocked(exists).mockImplementation(async (p: string) => (p as string).includes('templates'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return { created, skipped } counts', async () => {
    const result = await runScaffold({ agentDir: AGENT_DIR });
    expect(result).toHaveProperty('created');
    expect(result).toHaveProperty('skipped');
  });

  it('should create files for all agents and return created = AGENT_DEFINITIONS.length', async () => {
    const result = await runScaffold({ agentDir: AGENT_DIR });
    expect(result.created).toBe(AGENT_DEFINITIONS.length);
    expect(result.skipped).toBe(0);
  });

  it('should write agent files under agentDir with .md extension', async () => {
    await runScaffold({ agentDir: AGENT_DIR });
    const [firstPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(firstPath).toMatch(new RegExp(`^${AGENT_DIR}/`));
    expect(firstPath).toMatch(/\.md$/);
  });

  it('should skip existing destination files without force and return skipped count', async () => {
    vi.mocked(exists).mockResolvedValue(true); // templates and destinations exist

    const result = await runScaffold({ agentDir: AGENT_DIR });

    expect(writeFile).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(AGENT_DEFINITIONS.length);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skip'));
  });

  it('should overwrite existing files with force=true and return created count', async () => {
    vi.mocked(exists).mockResolvedValue(true); // templates and destinations exist

    const result = await runScaffold({ agentDir: AGENT_DIR, force: true });

    expect(writeFile).toHaveBeenCalledTimes(AGENT_DEFINITIONS.length);
    expect(result.created).toBe(AGENT_DEFINITIONS.length);
    expect(result.skipped).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('overwrite'));
  });

  it('should scaffold only the named agent and return created=1', async () => {
    const agentName = AGENT_DEFINITIONS[0].name;

    const result = await runScaffold({ agentDir: AGENT_DIR, agent: agentName });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).toContain(agentName);
  });

  it('should exit 1 for an unknown agent name', async () => {
    await runScaffold({ agentDir: AGENT_DIR, agent: 'nonexistent-agent' });

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should write to <agentDir>/<name>/CLAUDE.md with backend=claude', async () => {
    const agentName = AGENT_DEFINITIONS[0].name;

    await runScaffold({ agentDir: AGENT_DIR, agent: agentName, backend: 'claude' });

    const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).toBe(`${AGENT_DIR}/${agentName}/CLAUDE.md`);
  });

  it('should write to <agentDir>/<name>.md without backend', async () => {
    const agentName = AGENT_DEFINITIONS[0].name;

    await runScaffold({ agentDir: AGENT_DIR, agent: agentName });

    const [writtenPath] = vi.mocked(writeFile).mock.calls[0] as [string, ...unknown[]];
    expect(writtenPath).toBe(`${AGENT_DIR}/${agentName}.md`);
  });

  it('should warn and not count when template file is not found', async () => {
    vi.mocked(exists).mockResolvedValue(false); // no templates exist

    const result = await runScaffold({ agentDir: AGENT_DIR });

    expect(writeFile).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Template not found'));
  });

  it('should call mkdir with recursive=true before writing', async () => {
    const agentName = AGENT_DEFINITIONS[0].name;

    await runScaffold({ agentDir: AGENT_DIR, agent: agentName });

    expect(mkdir).toHaveBeenCalledWith(AGENT_DIR, { recursive: true });
  });

  it('should read template file content and write it to destination', async () => {
    const templateContent = '# My template content';
    vi.mocked(readFile).mockResolvedValue(templateContent as never);

    const agentName = AGENT_DEFINITIONS[0].name;
    await runScaffold({ agentDir: AGENT_DIR, agent: agentName });

    expect(writeFile).toHaveBeenCalledWith(
      expect.any(String),
      templateContent,
      'utf-8',
    );
  });
});
