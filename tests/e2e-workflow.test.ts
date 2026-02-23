import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WORKFLOW_PATH = join(import.meta.dirname, '..', '.github', 'workflows', 'e2e.yml');

describe('e2e workflow file', () => {
  let content: string;

  beforeAll(async () => {
    content = await readFile(WORKFLOW_PATH, 'utf-8');
  });

  it('exists and is non-empty', () => {
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('does not trigger on push events (only pull_request)', () => {
    expect(content).not.toMatch(/^\s*push\s*:/m);
  });

  it('triggers on pull_request events', () => {
    expect(content).toMatch(/^\s*pull_request\s*:/m);
  });

  it('runs on ubuntu-latest', () => {
    expect(content).toContain('ubuntu-latest');
  });

  it('sets CADRE_E2E to 1', () => {
    expect(content).toMatch(/CADRE_E2E\s*:\s*["']?1["']?/);
  });

  it('installs dependencies with npm ci', () => {
    expect(content).toContain('npm ci');
  });

  it('runs npm run test:e2e', () => {
    expect(content).toContain('npm run test:e2e');
  });

  it('sets timeout-minutes', () => {
    expect(content).toMatch(/timeout-minutes\s*:\s*\d+/);
  });

  it('uses actions/checkout', () => {
    expect(content).toMatch(/actions\/checkout/);
  });

  it('uses actions/setup-node', () => {
    expect(content).toMatch(/actions\/setup-node/);
  });

  it('does not reference any secrets', () => {
    expect(content).not.toMatch(/\$\{\{\s*secrets\./);
  });
});
