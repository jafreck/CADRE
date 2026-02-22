import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

// Mock ../src/util/fs.js
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  atomicWriteJSON: vi.fn(),
  ensureDir: vi.fn(),
  readFileOrNull: vi.fn(),
  writeTextFile: vi.fn(),
}));

// Mock ../src/cli/prompts.js
vi.mock('../src/cli/prompts.js', () => ({
  runPrompts: vi.fn(),
}));

import { confirm } from '@inquirer/prompts';
import { exists, atomicWriteJSON, ensureDir, readFileOrNull, writeTextFile } from '../src/util/fs.js';
import { runPrompts } from '../src/cli/prompts.js';

const mockConfirm = vi.mocked(confirm);
const mockExists = vi.mocked(exists);
const mockAtomicWriteJSON = vi.mocked(atomicWriteJSON);
const mockEnsureDir = vi.mocked(ensureDir);
const mockReadFileOrNull = vi.mocked(readFileOrNull);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockRunPrompts = vi.mocked(runPrompts);

const VALID_ANSWERS = {
  projectName: 'my-project',
  platform: 'github' as const,
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  issueMode: 'query' as const,
  githubAuthMethod: 'auto-detect' as const,
  commands: {},
};

describe('runInit', () => {
  let runInit: (opts: { yes: boolean; repoPath?: string }) => Promise<void>;
  const TEST_REPO = '/tmp/test-repo';

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockAtomicWriteJSON.mockResolvedValue(undefined);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteTextFile.mockResolvedValue(undefined);
    mockRunPrompts.mockResolvedValue(VALID_ANSWERS);
    const mod = await import('../src/cli/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('git repo validation', () => {
    it('should throw an error when .git does not exist', async () => {
      mockExists.mockResolvedValue(false);

      await expect(runInit({ yes: true, repoPath: TEST_REPO })).rejects.toThrow(
        /Not a git repository/,
      );
    });

    it('should include the path in the error message when not a git repo', async () => {
      mockExists.mockResolvedValue(false);

      await expect(runInit({ yes: true, repoPath: TEST_REPO })).rejects.toThrow(TEST_REPO);
    });

    it('should proceed when .git exists', async () => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        return false;
      });
      mockReadFileOrNull.mockResolvedValue(null);

      await expect(runInit({ yes: true, repoPath: TEST_REPO })).resolves.toBeUndefined();
    });
  });

  describe('existing config overwrite', () => {
    beforeEach(() => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        if (p.endsWith('cadre.config.json')) return true;
        return false;
      });
      mockReadFileOrNull.mockResolvedValue(null);
    });

    it('should skip the overwrite prompt and overwrite when --yes is true', async () => {
      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockAtomicWriteJSON).toHaveBeenCalled();
    });

    it('should prompt for overwrite when --yes is false', async () => {
      mockConfirm.mockResolvedValue(true);

      await runInit({ yes: false, repoPath: TEST_REPO });

      expect(mockConfirm).toHaveBeenCalledOnce();
    });

    it('should abort without writing when user declines overwrite', async () => {
      mockConfirm.mockResolvedValue(false);

      await runInit({ yes: false, repoPath: TEST_REPO });

      expect(mockAtomicWriteJSON).not.toHaveBeenCalled();
    });

    it('should write config when user confirms overwrite', async () => {
      mockConfirm.mockResolvedValue(true);

      await runInit({ yes: false, repoPath: TEST_REPO });

      expect(mockAtomicWriteJSON).toHaveBeenCalled();
    });
  });

  describe('successful initialization', () => {
    beforeEach(() => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        return false;
      });
      mockReadFileOrNull.mockResolvedValue(null);
    });

    it('should call runPrompts with the yes option', async () => {
      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockRunPrompts).toHaveBeenCalledWith({ yes: true });
    });

    it('should write cadre.config.json with content that passes schema validation', async () => {
      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockAtomicWriteJSON).toHaveBeenCalledOnce();
      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      // If schema validation fails, runInit would throw — so reaching here means it passed
      expect(writtenConfig).toBeDefined();
      expect((writtenConfig as any).projectName).toBe('my-project');
      expect((writtenConfig as any).repository).toBe('owner/repo');
    });

    it('should write cadre.config.json to the correct path', async () => {
      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockAtomicWriteJSON).toHaveBeenCalledWith(
        expect.stringContaining('cadre.config.json'),
        expect.any(Object),
      );
    });

    it('should create .github/agents/ directory', async () => {
      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockEnsureDir).toHaveBeenCalledWith(
        expect.stringMatching(/\.github[/\\]agents$/),
      );
    });

    it('should use issueMode=ids to build issues.ids config', async () => {
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, issueMode: 'ids' as const });

      await runInit({ yes: true, repoPath: TEST_REPO });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect((writtenConfig as any).issues).toEqual({ ids: [] });
    });

    it('should use issueMode=query to build issues.query config', async () => {
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, issueMode: 'query' as const });

      await runInit({ yes: true, repoPath: TEST_REPO });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect((writtenConfig as any).issues).toEqual({ query: { state: 'open', limit: 10 } });
    });
  });

  describe('.gitignore handling', () => {
    beforeEach(() => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        return false;
      });
    });

    it('should create .gitignore with .cadre/ when it does not exist', async () => {
      mockReadFileOrNull.mockResolvedValue(null);

      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('.cadre/'),
      );
    });

    it('should append .cadre/ to existing .gitignore that does not contain it', async () => {
      mockReadFileOrNull.mockResolvedValue('node_modules/\ndist/\n');

      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('.cadre/'),
      );
    });

    it('should not write .gitignore when .cadre/ is already present', async () => {
      mockReadFileOrNull.mockResolvedValue('node_modules/\n.cadre/\ndist/\n');

      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });

    it('should not write .gitignore when line exactly matches .cadre/ (no trailing newline)', async () => {
      mockReadFileOrNull.mockResolvedValue('node_modules/\n.cadre/');

      await runInit({ yes: true, repoPath: TEST_REPO });

      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });
  });

  describe('repoPath fallback', () => {
    it('should use process.cwd() when repoPath is not provided', async () => {
      // exists will be called with process.cwd()/.git
      mockExists.mockImplementation(async (p: string) => {
        if (p === `${process.cwd()}/.git`) return true;
        return false;
      });
      mockReadFileOrNull.mockResolvedValue(null);

      await expect(runInit({ yes: true })).resolves.toBeUndefined();

      expect(mockAtomicWriteJSON).toHaveBeenCalledWith(
        expect.stringContaining(process.cwd()),
        expect.any(Object),
      );
    });
  });
});
