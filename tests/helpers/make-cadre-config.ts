import { CadreConfigSchema, type CadreConfig } from '../../src/config/schema.js';

type CadreConfigInput = Record<string, unknown>;

export function makeCadreConfigInput(overrides: CadreConfigInput = {}): CadreConfigInput {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    ...overrides,
  };
}

export function makeCadreConfig(overrides: CadreConfigInput = {}): CadreConfig {
  return CadreConfigSchema.parse(makeCadreConfigInput(overrides));
}
