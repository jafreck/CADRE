import { writeFile, rename, mkdir, readFile, access, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';

/**
 * Atomically write a file by writing to a temp location first, then renaming.
 * This prevents partial/corrupt writes on crash.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  await writeFile(tmpPath, data, 'utf-8');
  await rename(tmpPath, filePath);
}

/**
 * Atomically write a JSON file with pretty printing.
 */
export async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Read a JSON file and parse it.
 */
export async function readJSON<T = unknown>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Check if a file or directory exists.
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Read a file as string, returning null if it doesn't exist.
 */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get a flat listing of all files under a directory, recursively.
 * Returns relative paths.
 */
export async function listFilesRecursive(dirPath: string, relativeTo?: string): Promise<string[]> {
  const base = relativeTo ?? dirPath;
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await walk(fullPath);
      } else {
        const relative = fullPath.slice(base.length + 1);
        results.push(relative);
      }
    }
  }

  await walk(dirPath);
  return results.sort();
}

/**
 * Read a text file, defaulting to empty string on missing.
 */
export async function readTextFile(filePath: string): Promise<string> {
  return (await readFileOrNull(filePath)) ?? '';
}

/**
 * Write a text file, ensuring directory exists.
 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Get file stats or null if the file doesn't exist.
 */
export async function statOrNull(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
