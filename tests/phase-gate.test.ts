import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AnalysisToPlanningGate,
  PlanningToImplementationGate,
  ImplementationToIntegrationGate,
  IntegrationToPRGate,
  AnalysisAmbiguityGate,
} from '../src/core/phase-gate.js';

// Mock simple-git for ImplementationToIntegrationGate tests
const mockDiff = vi.fn();
const mockGit = { diff: mockDiff };

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(progressDir: string, worktreePath = '/tmp/worktree', baseCommit?: string) {
  return { progressDir, worktreePath, baseCommit };
}

const VALID_ANALYSIS = `# Analysis
\`\`\`cadre-json
{"requirements":["Implement feature X"],"changeType":"feature","scope":"medium","affectedAreas":["src/core"],"ambiguities":[]}
\`\`\`
`;

const VALID_SCOUT = `# Scout Report
\`\`\`cadre-json
{"relevantFiles":[{"path":"src/core/checkpoint.ts","reason":"Core checkpoint logic"},{"path":"src/agents/types.ts","reason":"Agent type definitions"}],"dependencyMap":{},"testFiles":[],"estimatedChanges":[]}
\`\`\`
`;

const VALID_PLAN = `# Implementation Plan

\`\`\`cadre-json
[{"id":"task-001","name":"First Task","description":"Do the first thing.","files":["src/core/first.ts"],"dependencies":[],"acceptanceCriteria":["It works"]}]
\`\`\`
`;

const VALID_INTEGRATION_REPORT = `\`\`\`cadre-json
{"buildResult":{"command":"npm run build","exitCode":0,"output":"Build succeeded.","pass":true},"testResult":{"command":"npm test","exitCode":0,"output":"All tests passed.","pass":true},"overallPass":true,"regressionFailures":[],"baselineFailures":[]}
\`\`\`
`;

// ── AnalysisToPlanningGate ────────────────────────────────────────────────────

describe('AnalysisToPlanningGate', () => {
  let tempDir: string;
  let gate: AnalysisToPlanningGate;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-gate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    gate = new AnalysisToPlanningGate();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should pass with valid analysis.md and scout-report.md', async () => {
    await writeFile(join(tempDir, 'analysis.md'), VALID_ANALYSIS);
    await writeFile(join(tempDir, 'scout-report.md'), VALID_SCOUT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when analysis.md is missing', async () => {
    await writeFile(join(tempDir, 'scout-report.md'), VALID_SCOUT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('analysis.md is missing'))).toBe(true);
  });

  it('should fail when scout-report.md is missing', async () => {
    await writeFile(join(tempDir, 'analysis.md'), VALID_ANALYSIS);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('scout-report.md is missing'))).toBe(true);
  });

  it('should fail when analysis.md has no cadre-json block', async () => {
    await writeFile(join(tempDir, 'analysis.md'), '## Change Type\nfeat\n## Scope\nsrc/\n');
    await writeFile(join(tempDir, 'scout-report.md'), VALID_SCOUT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('cadre-json'))).toBe(true);
  });

  it('should fail when analysis.md cadre-json has an invalid changeType', async () => {
    const invalid = JSON.stringify({ requirements: ['Do something'], changeType: 'invalid-type', scope: 'medium', affectedAreas: [], ambiguities: [] });
    await writeFile(join(tempDir, 'analysis.md'), `\`\`\`cadre-json\n${invalid}\n\`\`\``);
    await writeFile(join(tempDir, 'scout-report.md'), VALID_SCOUT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('changeType'))).toBe(true);
  });

  it('should fail when analysis.md cadre-json has empty requirements', async () => {
    const empty = JSON.stringify({ requirements: [], changeType: 'feature', scope: 'medium', affectedAreas: [], ambiguities: [] });
    await writeFile(join(tempDir, 'analysis.md'), `\`\`\`cadre-json\n${empty}\n\`\`\``);
    await writeFile(join(tempDir, 'scout-report.md'), VALID_SCOUT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('requirements'))).toBe(true);
  });

  it('should fail when scout-report.md cadre-json has empty relevantFiles', async () => {
    const empty = JSON.stringify({ relevantFiles: [], dependencyMap: {}, testFiles: [], estimatedChanges: [] });
    await writeFile(join(tempDir, 'analysis.md'), VALID_ANALYSIS);
    await writeFile(join(tempDir, 'scout-report.md'), `\`\`\`cadre-json\n${empty}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('relevantFiles'))).toBe(true);
  });

  it('should accumulate multiple errors when both files have problems', async () => {
    await writeFile(join(tempDir, 'analysis.md'), '# Empty\n');
    await writeFile(join(tempDir, 'scout-report.md'), '# No paths here\n');

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ── PlanningToImplementationGate ──────────────────────────────────────────────

describe('PlanningToImplementationGate', () => {
  let tempDir: string;
  let worktreeDir: string;
  let gate: PlanningToImplementationGate;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-gate-test-${Date.now()}`);
    worktreeDir = join(tempDir, 'worktree');
    await mkdir(tempDir, { recursive: true });
    await mkdir(worktreeDir, { recursive: true });
    gate = new PlanningToImplementationGate();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should pass with a valid implementation plan', async () => {
    await writeFile(join(tempDir, 'implementation-plan.md'), VALID_PLAN);
    await mkdir(join(worktreeDir, 'src/core'), { recursive: true });
    await writeFile(join(worktreeDir, 'src/core/first.ts'), '');

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when implementation-plan.md is missing', async () => {
    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('implementation-plan.md is missing'))).toBe(true);
  });

  it('should fail when implementation-plan.md has no cadre-json block', async () => {
    await writeFile(join(tempDir, 'implementation-plan.md'), '# Plan\nNo cadre-json block here.\n');

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('missing a cadre-json block'))).toBe(true);
  });

  it('should fail when the cadre-json block contains no tasks', async () => {
    await writeFile(join(tempDir, 'implementation-plan.md'), '```cadre-json\n[]\n```\n');

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('no tasks'))).toBe(true);
  });

  it('should fail when a task is missing a description', async () => {
    const task = { id: 'task-001', name: 'My Task', description: '', files: ['src/foo.ts'], dependencies: [], acceptanceCriteria: ['Works'] };
    const plan = `\`\`\`cadre-json\n${JSON.stringify([task])}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('missing a description'))).toBe(true);
  });

  it('should fail when a task has no files', async () => {
    const task = { id: 'task-001', name: 'My Task', description: 'Do something.', files: [], dependencies: [], acceptanceCriteria: ['Works'] };
    const plan = `\`\`\`cadre-json\n${JSON.stringify([task])}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('does not list any files'))).toBe(true);
  });

  it('should fail when a task has no acceptance criteria', async () => {
    const task = { id: 'task-001', name: 'My Task', description: 'Do something.', files: ['src/foo.ts'], dependencies: [], acceptanceCriteria: [] };
    const plan = `\`\`\`cadre-json\n${JSON.stringify([task])}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('no acceptance criteria'))).toBe(true);
  });

  it('should fail when tasks have a circular dependency', async () => {
    const tasks = [
      { id: 'task-001', name: 'First', description: 'Do first.', files: ['src/first.ts'], dependencies: ['task-002'], acceptanceCriteria: ['Works'] },
      { id: 'task-002', name: 'Second', description: 'Do second.', files: ['src/second.ts'], dependencies: ['task-001'], acceptanceCriteria: ['Works'] },
    ];
    const plan = `\`\`\`cadre-json\n${JSON.stringify(tasks)}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('dependency cycle'))).toBe(true);
  });

  it('should pass with multiple valid tasks and linear dependencies', async () => {
    const tasks = [
      { id: 'task-001', name: 'First', description: 'Do first.', files: ['src/first.ts'], dependencies: [], acceptanceCriteria: ['Works'] },
      { id: 'task-002', name: 'Second', description: 'Do second.', files: ['src/second.ts'], dependencies: ['task-001'], acceptanceCriteria: ['Also works'] },
    ];
    const plan = `\`\`\`cadre-json\n${JSON.stringify(tasks)}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);
    await mkdir(join(worktreeDir, 'src'), { recursive: true });
    await writeFile(join(worktreeDir, 'src/first.ts'), '');
    await writeFile(join(worktreeDir, 'src/second.ts'), '');

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should warn (not fail) when a referenced file does not exist', async () => {
    await writeFile(join(tempDir, 'implementation-plan.md'), VALID_PLAN);
    // Do NOT create src/core/first.ts in worktreeDir

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('task-001') && w.includes('src/core/first.ts'))).toBe(true);
  });

  it('should warn for every missing file across all tasks', async () => {
    const tasks = [
      { id: 'task-001', name: 'First', description: 'Do first.', files: ['src/first.ts'], dependencies: [], acceptanceCriteria: ['Works'] },
      { id: 'task-002', name: 'Second', description: 'Do second.', files: ['src/second.ts'], dependencies: ['task-001'], acceptanceCriteria: ['Also works'] },
    ];
    const plan = `\`\`\`cadre-json\n${JSON.stringify(tasks)}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);
    // Create worktreeDir but no source files

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('task-001') && w.includes('src/first.ts'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('task-002') && w.includes('src/second.ts'))).toBe(true);
  });

  it('should warn only for missing files when some exist and some do not', async () => {
    const tasks = [
      { id: 'task-001', name: 'First', description: 'Do first.', files: ['src/exists.ts'], dependencies: [], acceptanceCriteria: ['Works'] },
      { id: 'task-002', name: 'Second', description: 'Do second.', files: ['src/missing.ts'], dependencies: ['task-001'], acceptanceCriteria: ['Also works'] },
    ];
    const plan = `\`\`\`cadre-json\n${JSON.stringify(tasks)}\n\`\`\``;
    await writeFile(join(tempDir, 'implementation-plan.md'), plan);
    await mkdir(join(worktreeDir, 'src'), { recursive: true });
    await writeFile(join(worktreeDir, 'src/exists.ts'), '');
    // Do NOT create src/missing.ts

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => w.includes('src/missing.ts'))).toBe(true);
    expect(result.warnings.every((w) => !w.includes('src/exists.ts'))).toBe(true);
  });

  it('should pass with no warnings when all referenced files exist', async () => {
    await writeFile(join(tempDir, 'implementation-plan.md'), VALID_PLAN);
    await mkdir(join(worktreeDir, 'src/core'), { recursive: true });
    await writeFile(join(worktreeDir, 'src/core/first.ts'), '');

    const result = await gate.validate(makeContext(tempDir, worktreeDir));
    expect(result.status).toBe('pass');
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ── ImplementationToIntegrationGate ──────────────────────────────────────────

describe('ImplementationToIntegrationGate', () => {
  let gate: ImplementationToIntegrationGate;

  beforeEach(() => {
    gate = new ImplementationToIntegrationGate();
    mockDiff.mockReset();
  });

  it('should pass when there is a non-empty HEAD diff', async () => {
    mockDiff.mockResolvedValue('diff --git a/src/foo.ts ...\n+added line');

    const result = await gate.validate(makeContext('/tmp/worktree'));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should pass when HEAD diff is empty but staged diff is non-empty', async () => {
    mockDiff
      .mockResolvedValueOnce('') // HEAD diff
      .mockResolvedValueOnce('diff --git a/src/bar.ts ...\n+staged line'); // --cached

    const result = await gate.validate(makeContext('/tmp/worktree'));
    expect(result.status).toBe('pass');
  });

  it('should fail when both HEAD diff and staged diff are empty', async () => {
    mockDiff.mockResolvedValue('');

    const result = await gate.validate(makeContext('/tmp/worktree'));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('No file changes detected'))).toBe(true);
  });

  it('should use baseCommit range when provided', async () => {
    mockDiff.mockResolvedValue('diff content');

    const result = await gate.validate(makeContext('/tmp/worktree', '/tmp/worktree', 'abc123'));
    expect(result.status).toBe('pass');
    expect(mockDiff).toHaveBeenCalledWith(['abc123..HEAD']);
  });

  it('should pass with warning when git throws (non-git environment)', async () => {
    mockDiff.mockRejectedValue(new Error('git error'));

    const result = await gate.validate(makeContext('/tmp/worktree'));
    expect(result.status).not.toBe('fail');
    expect(result.warnings.some((w) => w.includes('Could not verify git diff'))).toBe(true);
  });
});

// ── IntegrationToPRGate ───────────────────────────────────────────────────────

describe('IntegrationToPRGate', () => {
  let tempDir: string;
  let gate: IntegrationToPRGate;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-gate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    gate = new IntegrationToPRGate();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should pass with a valid integration-report.md', async () => {
    await writeFile(join(tempDir, 'integration-report.md'), VALID_INTEGRATION_REPORT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when integration-report.md is missing', async () => {
    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('integration-report.md is missing'))).toBe(true);
  });

  it('should fail when build result did not pass', async () => {
    const report = JSON.stringify({
      buildResult: { command: 'npm run build', exitCode: 1, output: 'Build failed.', pass: false },
      testResult: { command: 'npm test', exitCode: 0, output: 'All tests passed.', pass: true },
      overallPass: false,
      regressionFailures: [],
      baselineFailures: [],
    });
    await writeFile(join(tempDir, 'integration-report.md'), `\`\`\`cadre-json\n${report}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('build failed'))).toBe(true);
  });

  it('should fail when test result did not pass', async () => {
    const report = JSON.stringify({
      buildResult: { command: 'npm run build', exitCode: 0, output: 'Build succeeded.', pass: true },
      testResult: { command: 'npm test', exitCode: 1, output: '3 tests failed.', pass: false },
      overallPass: false,
      regressionFailures: [],
      baselineFailures: [],
    });
    await writeFile(join(tempDir, 'integration-report.md'), `\`\`\`cadre-json\n${report}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('tests failed'))).toBe(true);
  });

  it('should fail when integration-report.md has no cadre-json block', async () => {
    await writeFile(join(tempDir, 'integration-report.md'), '# Integration Report\nNothing here.\n');

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('cadre-json'))).toBe(true);
  });

  it('should fail when regressionFailures contains entries', async () => {
    const report = JSON.stringify({
      buildResult: { command: 'npm run build', exitCode: 0, output: 'Build succeeded.', pass: true },
      testResult: { command: 'npm test', exitCode: 0, output: 'Some passed.', pass: true },
      overallPass: false,
      regressionFailures: ['test-foo: AssertionError'],
      baselineFailures: [],
    });
    await writeFile(join(tempDir, 'integration-report.md'), `\`\`\`cadre-json\n${report}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('new regression failures'))).toBe(true);
  });

  it('should pass when regressionFailures is empty', async () => {
    await writeFile(join(tempDir, 'integration-report.md'), VALID_INTEGRATION_REPORT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should warn but not fail when baselineFailures contains entries', async () => {
    const report = JSON.stringify({
      buildResult: { command: 'npm run build', exitCode: 0, output: 'Build succeeded.', pass: true },
      testResult: { command: 'npm test', exitCode: 0, output: 'All tests passed.', pass: true },
      overallPass: true,
      regressionFailures: [],
      baselineFailures: ['test-legacy: known failure'],
    });
    await writeFile(join(tempDir, 'integration-report.md'), `\`\`\`cadre-json\n${report}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).not.toBe('fail');
    expect(result.warnings.some((w) => w.includes('pre-existing failures'))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass without warning when baselineFailures is empty', async () => {
    await writeFile(join(tempDir, 'integration-report.md'), VALID_INTEGRATION_REPORT);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.warnings.some((w) => w.includes('pre-existing failures'))).toBe(false);
  });

  it('should fail with errors and warn when both regressionFailures and baselineFailures are populated', async () => {
    const report = JSON.stringify({
      buildResult: { command: 'npm run build', exitCode: 0, output: 'Build succeeded.', pass: true },
      testResult: { command: 'npm test', exitCode: 0, output: 'Some passed.', pass: true },
      overallPass: false,
      regressionFailures: ['test-new: broken'],
      baselineFailures: ['test-old: known issue'],
    });
    await writeFile(join(tempDir, 'integration-report.md'), `\`\`\`cadre-json\n${report}\n\`\`\``);

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('new regression failures'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('pre-existing failures'))).toBe(true);
  });
});

// ── AnalysisAmbiguityGate ─────────────────────────────────────────────────────

describe('AnalysisAmbiguityGate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-ambiguity-gate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should pass when analysis.md has no ambiguities section', async () => {
    await writeFile(join(tempDir, 'analysis.md'), VALID_ANALYSIS);
    const gate = new AnalysisAmbiguityGate();

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should pass when analysis.md has an empty ambiguities section', async () => {
    const content = `# Analysis\n## Requirements\n- Something\n## Ambiguities\n\n## Scope\nsrc/\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate();

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
  });

  it('should warn (not fail) when analysis.md is missing', async () => {
    const gate = new AnalysisAmbiguityGate();

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('analysis.md is missing'))).toBe(true);
  });

  it('should warn when ambiguity count is > 0 but <= threshold', async () => {
    const content = `# Analysis\n## Ambiguities\n- Unclear requirement A\n- Unclear requirement B\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate({ ambiguityThreshold: 5, haltOnAmbiguity: false });

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('2 ambiguities found'))).toBe(true);
  });

  it('should warn when count == threshold', async () => {
    const ambiguities = Array.from({ length: 3 }, (_, i) => `- Ambiguity ${i + 1}`).join('\n');
    const content = `# Analysis\n## Ambiguities\n${ambiguities}\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate({ ambiguityThreshold: 3, haltOnAmbiguity: true });

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when count > threshold and haltOnAmbiguity is true', async () => {
    const ambiguities = Array.from({ length: 4 }, (_, i) => `- Ambiguity ${i + 1}`).join('\n');
    const content = `# Analysis\n## Ambiguities\n${ambiguities}\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate({ ambiguityThreshold: 2, haltOnAmbiguity: true });

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('4 ambiguities found'))).toBe(true);
  });

  it('should warn (not fail) when count > threshold but haltOnAmbiguity is false', async () => {
    const ambiguities = Array.from({ length: 6 }, (_, i) => `- Ambiguity ${i + 1}`).join('\n');
    const content = `# Analysis\n## Ambiguities\n${ambiguities}\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate({ ambiguityThreshold: 3, haltOnAmbiguity: false });

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('6 ambiguities found'))).toBe(true);
  });

  it('should use default threshold of 5 and haltOnAmbiguity false when no options given', async () => {
    const ambiguities = Array.from({ length: 6 }, (_, i) => `- Ambiguity ${i + 1}`).join('\n');
    const content = `# Analysis\n## Ambiguities\n${ambiguities}\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate();

    // 6 > default threshold of 5, but haltOnAmbiguity defaults to false → warn not fail
    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.errors).toHaveLength(0);
  });

  it('should not count ambiguities from sections after ambiguities heading', async () => {
    const content = `# Analysis\n## Ambiguities\n- Only one\n## Other Section\n- Not counted\n- Also not counted\n`;
    await writeFile(join(tempDir, 'analysis.md'), content);
    const gate = new AnalysisAmbiguityGate({ ambiguityThreshold: 5, haltOnAmbiguity: true });

    const result = await gate.validate(makeContext(tempDir));
    expect(result.status).toBe('warn');
    expect(result.warnings.some((w) => w.includes('1 ambiguity found'))).toBe(true);
  });
});
