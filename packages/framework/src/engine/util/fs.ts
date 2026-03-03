/**
 * Minimal filesystem utilities for the pipeline engine.
 */

import { writeFile, rename, mkdir, readFile, access, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';

/**
 * Atomically write a file by writing to a temp location first, then renaming.
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

export { copyFile };
