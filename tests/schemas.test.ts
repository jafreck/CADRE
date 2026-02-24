import { describe, it, expect } from 'vitest';
import {
  analysisSchema,
  scoutReportSchema,
  implementationTaskSchema,
  implementationPlanSchema,
  reviewIssueSchema,
  reviewSchema,
  commandResultSchema,
  integrationReportSchema,
  prContentSchema,
} from '../src/agents/schemas/index.js';

// ---------------------------------------------------------------------------
// analysisSchema
// ---------------------------------------------------------------------------
describe('analysisSchema', () => {
  const valid = {
    requirements: ['req1', 'req2'],
    changeType: 'feature' as const,
    scope: 'medium' as const,
    affectedAreas: ['src/core'],
    ambiguities: [],
  };

  it('should accept a valid AnalysisResult', () => {
    const result = analysisSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept an empty ambiguities array', () => {
    const result = analysisSchema.safeParse({ ...valid, ambiguities: [] });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown changeType value', () => {
    const result = analysisSchema.safeParse({ ...valid, changeType: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('should reject an unknown scope value', () => {
    const result = analysisSchema.safeParse({ ...valid, scope: 'huge' });
    expect(result.success).toBe(false);
  });

  it('should reject when requirements field is missing', () => {
    const { requirements: _r, ...without } = valid;
    const result = analysisSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when affectedAreas field is missing', () => {
    const { affectedAreas: _a, ...without } = valid;
    const result = analysisSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept all valid changeType values', () => {
    const types = ['bug-fix', 'feature', 'refactor', 'docs', 'chore'] as const;
    for (const changeType of types) {
      const result = analysisSchema.safeParse({ ...valid, changeType });
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid scope values', () => {
    const scopes = ['small', 'medium', 'large'] as const;
    for (const scope of scopes) {
      const result = analysisSchema.safeParse({ ...valid, scope });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// scoutReportSchema
// ---------------------------------------------------------------------------
describe('scoutReportSchema', () => {
  const valid = {
    relevantFiles: [{ path: 'src/foo.ts', reason: 'core module' }],
    dependencyMap: { 'src/foo.ts': ['src/bar.ts'] },
    testFiles: ['tests/foo.test.ts'],
    estimatedChanges: [{ path: 'src/foo.ts', linesEstimate: 20 }],
  };

  it('should accept a valid ScoutReport', () => {
    const result = scoutReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept empty arrays for relevantFiles, testFiles, and estimatedChanges', () => {
    const result = scoutReportSchema.safeParse({
      relevantFiles: [],
      dependencyMap: {},
      testFiles: [],
      estimatedChanges: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject when relevantFiles entry is missing reason', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      relevantFiles: [{ path: 'src/foo.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject when estimatedChanges entry is missing linesEstimate', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      estimatedChanges: [{ path: 'src/foo.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject when dependencyMap field is missing', () => {
    const { dependencyMap: _d, ...without } = valid;
    const result = scoutReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric linesEstimate', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      estimatedChanges: [{ path: 'src/foo.ts', linesEstimate: 'twenty' }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// implementationTaskSchema / implementationPlanSchema
// ---------------------------------------------------------------------------
describe('implementationTaskSchema', () => {
  const validTask = {
    id: 'session-001',
    name: 'Add feature',
    rationale: 'Needed for productivity',
    dependencies: [],
    steps: [{
      id: 'session-001-step-001',
      name: 'Add feature step',
      description: 'Detailed description',
      files: ['src/feature.ts'],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Should work'],
    }],
  };

  it('should accept a valid ImplementationTask', () => {
    const result = implementationTaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });

  it('should reject an unknown complexity value', () => {
    const invalid = { ...validTask, steps: [{ ...validTask.steps[0], complexity: 'extreme' }] };
    const result = implementationTaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject when id field is missing', () => {
    const { id: _i, ...without } = validTask;
    const result = implementationTaskSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when acceptanceCriteria field is missing', () => {
    const { acceptanceCriteria: _a, ...withoutAc } = validTask.steps[0];
    const invalid = { ...validTask, steps: [withoutAc] };
    const result = implementationTaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept all valid complexity values', () => {
    const complexities = ['simple', 'moderate', 'complex'] as const;
    for (const complexity of complexities) {
      const invalid = { ...validTask, steps: [{ ...validTask.steps[0], complexity }] };
      const result = implementationTaskSchema.safeParse(invalid);
      expect(result.success).toBe(true);
    }
  });
});

describe('implementationPlanSchema', () => {
  const validTask = {
    id: 'session-001',
    name: 'Add feature',
    rationale: 'Needed for productivity',
    dependencies: [],
    steps: [{
      id: 'session-001-step-001',
      name: 'Add feature step',
      description: 'Detailed description',
      files: ['src/feature.ts'],
      complexity: 'simple' as const,
      acceptanceCriteria: ['Should work'],
    }],
  };

  it('should accept an empty plan array', () => {
    const result = implementationPlanSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('should accept a plan with multiple valid tasks', () => {
    const result = implementationPlanSchema.safeParse([
      validTask,
      { ...validTask, id: 'session-002', name: 'Second session', steps: [{ ...validTask.steps[0], id: 'session-002-step-001' }] },
    ]);
    expect(result.success).toBe(true);
  });

  it('should reject a plan containing an invalid task', () => {
    const invalid = { ...validTask, steps: [{ ...validTask.steps[0], complexity: 'invalid' }] };
    const result = implementationPlanSchema.safeParse([invalid]);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reviewIssueSchema / reviewSchema
// ---------------------------------------------------------------------------
describe('reviewIssueSchema', () => {
  const valid = {
    file: 'src/auth.ts',
    severity: 'error' as const,
    description: 'Missing null check',
  };

  it('should accept a valid ReviewIssue without line', () => {
    const result = reviewIssueSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a ReviewIssue with optional line number', () => {
    const result = reviewIssueSchema.safeParse({ ...valid, line: 42 });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown severity value', () => {
    const result = reviewIssueSchema.safeParse({ ...valid, severity: 'critical' });
    expect(result.success).toBe(false);
  });

  it('should reject when file field is missing', () => {
    const { file: _f, ...without } = valid;
    const result = reviewIssueSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept all valid severity values', () => {
    const severities = ['error', 'warning', 'suggestion'] as const;
    for (const severity of severities) {
      const result = reviewIssueSchema.safeParse({ ...valid, severity });
      expect(result.success).toBe(true);
    }
  });
});

describe('reviewSchema', () => {
  const valid = {
    verdict: 'pass' as const,
    issues: [],
    summary: 'All checks passed',
  };

  it('should accept a valid ReviewResult with no issues', () => {
    const result = reviewSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a ReviewResult with issues', () => {
    const result = reviewSchema.safeParse({
      verdict: 'needs-fixes',
      issues: [{ file: 'src/foo.ts', severity: 'error', description: 'Bug' }],
      summary: 'Issues found',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown verdict value', () => {
    const result = reviewSchema.safeParse({ ...valid, verdict: 'rejected' });
    expect(result.success).toBe(false);
  });

  it('should reject when summary field is missing', () => {
    const { summary: _s, ...without } = valid;
    const result = reviewSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when issues field is missing', () => {
    const { issues: _i, ...without } = valid;
    const result = reviewSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// commandResultSchema / integrationReportSchema
// ---------------------------------------------------------------------------
describe('commandResultSchema', () => {
  const valid = {
    command: 'npm run build',
    exitCode: 0,
    output: 'Build succeeded',
    pass: true,
  };

  it('should accept a valid CommandResult', () => {
    const result = commandResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a failing CommandResult', () => {
    const result = commandResultSchema.safeParse({ ...valid, exitCode: 1, pass: false });
    expect(result.success).toBe(true);
  });

  it('should reject when pass field is missing', () => {
    const { pass: _p, ...without } = valid;
    const result = commandResultSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric exitCode', () => {
    const result = commandResultSchema.safeParse({ ...valid, exitCode: 'zero' });
    expect(result.success).toBe(false);
  });
});

describe('integrationReportSchema', () => {
  const commandResult = { command: 'npm run build', exitCode: 0, output: '', pass: true };
  const valid = {
    buildResult: commandResult,
    testResult: { ...commandResult, command: 'npm test' },
    overallPass: true,
  };

  it('should accept a valid IntegrationReport without lintResult', () => {
    const result = integrationReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a valid IntegrationReport with optional lintResult', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      lintResult: { ...commandResult, command: 'npm run lint' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject when buildResult field is missing', () => {
    const { buildResult: _b, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when testResult field is missing', () => {
    const { testResult: _t, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when overallPass field is missing', () => {
    const { overallPass: _o, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject a malformed lintResult', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      lintResult: { command: 'npm run lint' }, // missing exitCode, output, pass
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// prContentSchema
// ---------------------------------------------------------------------------
describe('prContentSchema', () => {
  const valid = {
    title: 'Add feature X',
    body: 'This PR adds feature X by doing Y.',
    labels: ['enhancement'],
  };

  it('should accept a valid PRContent', () => {
    const result = prContentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept PRContent with empty labels array', () => {
    const result = prContentSchema.safeParse({ ...valid, labels: [] });
    expect(result.success).toBe(true);
  });

  it('should reject when title field is missing', () => {
    const { title: _t, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when body field is missing', () => {
    const { body: _b, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when labels field is missing', () => {
    const { labels: _l, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject non-string label entries', () => {
    const result = prContentSchema.safeParse({ ...valid, labels: [42] });
    expect(result.success).toBe(false);
  });
});
