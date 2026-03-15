/**
 * Filesystem utilities for cadre.
 *
 * Core utilities (atomicWriteFile, atomicWriteJSON, readJSON, exists, ensureDir)
 * are re-exported from @cadre-dev/framework/util/fs.
 * Cadre-specific helpers are defined locally below.
 */

import { readFile, readdir, stat, realpath, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ── Re-exported from framework ──
export { atomicWriteFile, atomicWriteJSON, readJSON, exists, ensureDir, copyFile } from '@cadre-dev/framework/util/fs';

// ── Cadre-specific helpers ──

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
 * Returns relative paths. Skips node_modules and .git.
 */
export async function listFilesRecursive(dirPath: string, relativeTo?: string): Promise<string[]> {
  const base = relativeTo ?? dirPath;
  const results: string[] = [];
  const visited = new Set<string>();
  const rootReal = await realpath(dirPath);

  async function walk(current: string): Promise<void> {
    const real = await realpath(current);
    if (visited.has(real)) return;
    if (!real.startsWith(rootReal)) return;
    visited.add(real);
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
  await mkdir(dirname(filePath), { recursive: true });
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
