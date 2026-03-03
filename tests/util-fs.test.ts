import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'uuid-123'),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import * as fsPromises from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  atomicWriteFile,
  atomicWriteJSON,
  ensureDir,
  exists,
  listFilesRecursive,
  readFileOrNull,
  readJSON,
  readTextFile,
  statOrNull,
  writeTextFile,
} from '../src/util/fs.js';

const mockedWriteFile = vi.mocked(fsPromises.writeFile);
const mockedRename = vi.mocked(fsPromises.rename);
const mockedMkdir = vi.mocked(fsPromises.mkdir);
const mockedReadFile = vi.mocked(fsPromises.readFile);
const mockedAccess = vi.mocked(fsPromises.access);
const mockedReaddir = vi.mocked(fsPromises.readdir);
const mockedStat = vi.mocked(fsPromises.stat);

describe('util/fs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('atomicWriteFile', () => {
    it('creates parent directory and writes via temp file before rename', async () => {
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedRename.mockResolvedValue(undefined);

      await atomicWriteFile('/tmp/out/data.json', 'hello');

      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/out', { recursive: true });
      expect(mockedWriteFile).toHaveBeenCalledWith('/tmp/out/.tmp-uuid-123', 'hello', 'utf-8');
      expect(mockedRename).toHaveBeenCalledWith('/tmp/out/.tmp-uuid-123', '/tmp/out/data.json');
    });
  });

  describe('atomicWriteJSON', () => {
    it('writes pretty-printed JSON with trailing newline', async () => {
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);
      mockedRename.mockResolvedValue(undefined);

      await atomicWriteJSON('/tmp/state/value.json', { a: 1 });

      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/state/.tmp-uuid-123',
        '{\n  "a": 1\n}\n',
        'utf-8',
      );
      expect(mockedRename).toHaveBeenCalledWith('/tmp/state/.tmp-uuid-123', '/tmp/state/value.json');
    });
  });

  describe('readJSON', () => {
    it('parses JSON content from disk', async () => {
      mockedReadFile.mockResolvedValue('{"ok":true}');

      await expect(readJSON<{ ok: boolean }>('/tmp/value.json')).resolves.toEqual({ ok: true });
      expect(mockedReadFile).toHaveBeenCalledWith('/tmp/value.json', 'utf-8');
    });

    it('propagates parse errors for invalid JSON', async () => {
      mockedReadFile.mockResolvedValue('{bad');

      await expect(readJSON('/tmp/invalid.json')).rejects.toThrow();
    });
  });

  describe('exists', () => {
    it('returns true when access succeeds', async () => {
      mockedAccess.mockResolvedValue(undefined);

      await expect(exists('/tmp/here')).resolves.toBe(true);
      expect(mockedAccess).toHaveBeenCalledWith('/tmp/here', constants.F_OK);
    });

    it('returns false when access throws', async () => {
      mockedAccess.mockRejectedValue(new Error('missing'));

      await expect(exists('/tmp/missing')).resolves.toBe(false);
    });
  });

  describe('ensureDir', () => {
    it('creates directory recursively', async () => {
      mockedMkdir.mockResolvedValue(undefined);

      await ensureDir('/tmp/new-dir');

      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/new-dir', { recursive: true });
    });
  });

  describe('readFileOrNull and readTextFile', () => {
    it('returns file contents when read succeeds', async () => {
      mockedReadFile.mockResolvedValue('abc');

      await expect(readFileOrNull('/tmp/file.txt')).resolves.toBe('abc');
      await expect(readTextFile('/tmp/file.txt')).resolves.toBe('abc');
    });

    it('returns null from readFileOrNull and empty string from readTextFile on error', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      await expect(readFileOrNull('/tmp/missing.txt')).resolves.toBeNull();
      await expect(readTextFile('/tmp/missing.txt')).resolves.toBe('');
    });
  });

  describe('listFilesRecursive', () => {
    it('recurses, skips node_modules/.git, and sorts relative paths', async () => {
      mockedReaddir.mockImplementation(async (dirPath) => {
        if (dirPath === '/repo') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: '.git', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
            { name: 'README.md', isDirectory: () => false },
          ] as Array<{ name: string; isDirectory: () => boolean }>;
        }

        if (dirPath === '/repo/src') {
          return [
            { name: 'b.ts', isDirectory: () => false },
            { name: 'a.ts', isDirectory: () => false },
            { name: 'nested', isDirectory: () => true },
          ] as Array<{ name: string; isDirectory: () => boolean }>;
        }

        if (dirPath === '/repo/src/nested') {
          return [{ name: 'z.ts', isDirectory: () => false }] as Array<{
            name: string;
            isDirectory: () => boolean;
          }>;
        }

        return [];
      });

      await expect(listFilesRecursive('/repo')).resolves.toEqual([
        'README.md',
        'src/a.ts',
        'src/b.ts',
        'src/nested/z.ts',
      ]);
    });

    it('uses explicit relativeTo base when provided', async () => {
      mockedReaddir.mockResolvedValue([{ name: 'index.ts', isDirectory: () => false }]);

      await expect(listFilesRecursive('/repo/src', '/repo')).resolves.toEqual(['src/index.ts']);
    });
  });

  describe('writeTextFile', () => {
    it('ensures directory before writing utf-8 text', async () => {
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);

      await writeTextFile('/tmp/notes/todo.txt', 'todo');

      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/notes', { recursive: true });
      expect(mockedWriteFile).toHaveBeenCalledWith('/tmp/notes/todo.txt', 'todo', 'utf-8');
    });
  });

  describe('statOrNull', () => {
    it('returns stat result on success', async () => {
      const statResult = { mtimeMs: 12 } as Awaited<ReturnType<typeof fsPromises.stat>>;
      mockedStat.mockResolvedValue(statResult);

      await expect(statOrNull('/tmp/file.txt')).resolves.toBe(statResult);
    });

    it('returns null when stat throws', async () => {
      mockedStat.mockRejectedValue(new Error('ENOENT'));

      await expect(statOrNull('/tmp/missing.txt')).resolves.toBeNull();
    });
  });
});