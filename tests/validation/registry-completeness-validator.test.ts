import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from '../helpers/make-runtime-config.js';
import type { AgentDefinition } from '../../src/agents/types.js';
import type { AgentContextDescriptor } from '../../src/agents/types.js';

// Mock the `exists` helper from util/fs
vi.mock('../../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

// Mock AGENT_DEFINITIONS from agents/types
vi.mock('../../src/agents/types.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/agents/types.js')>();
  return {
    ...original,
    AGENT_DEFINITIONS: [] as AgentDefinition[],
  };
});

// Mock AGENT_CONTEXT_REGISTRY from agents/context-builder
vi.mock('../../src/agents/context-builder.js', () => ({
  AGENT_CONTEXT_REGISTRY: {} as Record<string, AgentContextDescriptor>,
}));

import { exists } from '../../src/util/fs.js';
import { AGENT_DEFINITIONS } from '../../src/agents/types.js';
import { AGENT_CONTEXT_REGISTRY } from '../../src/agents/context-builder.js';
import { registryCompletenessValidator } from '../../src/validation/registry-completeness-validator.js';

const config = makeRuntimeConfig();

function setAgentDefinitions(defs: AgentDefinition[]): void {
  (AGENT_DEFINITIONS as unknown as AgentDefinition[]).length = 0;
  (AGENT_DEFINITIONS as unknown as AgentDefinition[]).push(...defs);
}

function setRegistry(entries: Record<string, Partial<AgentContextDescriptor>>): void {
  const reg = AGENT_CONTEXT_REGISTRY as Record<string, Partial<AgentContextDescriptor>>;
  for (const key of Object.keys(reg)) {
    delete reg[key];
  }
  Object.assign(reg, entries);
}

const fakeAgent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  name: 'issue-analyst',
  phase: 1,
  phaseName: 'Analysis & Scouting',
  description: 'test agent',
  hasStructuredOutput: false,
  templateFile: 'issue-analyst.md',
  ...overrides,
});

describe('registryCompletenessValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAgentDefinitions([]);
    setRegistry({});
  });

  it('should expose the name "registry-completeness"', () => {
    expect(registryCompletenessValidator.name).toBe('registry-completeness');
  });

  it('should return passed:true when there are no agent definitions', async () => {
    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return passed:true when all agents have templates, registry entries, and schemas', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', hasStructuredOutput: true, templateFile: 'issue-analyst.md' }),
    ]);
    setRegistry({
      'issue-analyst': {
        phase: 1,
        outputFile: () => '',
        inputFiles: async () => [],
        outputSchema: { type: 'object' },
      },
    });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return an error when a template file does not exist', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', templateFile: 'missing.md' }),
    ]);
    setRegistry({ 'issue-analyst': { phase: 1, outputFile: () => '', inputFiles: async () => [] } });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing.md');
    expect(result.errors[0]).toContain('does not exist');
  });

  it('should return an error when agent is not in AGENT_CONTEXT_REGISTRY', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'codebase-scout', templateFile: 'codebase-scout.md' }),
    ]);
    setRegistry({}); // empty registry
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('codebase-scout');
    expect(result.errors[0]).toContain('AGENT_CONTEXT_REGISTRY');
  });

  it('should return an error when hasStructuredOutput is true but outputSchema is missing', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', hasStructuredOutput: true }),
    ]);
    setRegistry({
      'issue-analyst': { phase: 1, outputFile: () => '', inputFiles: async () => [] },
      // no outputSchema
    });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('hasStructuredOutput: true');
    expect(result.errors[0]).toContain('outputSchema');
  });

  it('should not report outputSchema error when hasStructuredOutput is false', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'code-writer', hasStructuredOutput: false }),
    ]);
    setRegistry({
      'code-writer': { phase: 3, outputFile: () => '', inputFiles: async () => [] },
      // no outputSchema, but that's fine since hasStructuredOutput is false
    });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should not report outputSchema error when agent is not in registry', async () => {
    // The structured output check is gated on registry membership
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', hasStructuredOutput: true }),
    ]);
    setRegistry({}); // not in registry
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    // Only the "not in registry" error, not the outputSchema error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('no entry in AGENT_CONTEXT_REGISTRY');
  });

  it('should accumulate multiple errors across different agents', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', templateFile: 'missing.md', hasStructuredOutput: true }),
      fakeAgent({ name: 'codebase-scout', templateFile: 'codebase-scout.md' }),
    ]);
    // issue-analyst is in registry but without schema; codebase-scout not in registry
    setRegistry({
      'issue-analyst': { phase: 1, outputFile: () => '', inputFiles: async () => [] },
    });
    vi.mocked(exists).mockResolvedValue(false); // both templates missing

    const result = await registryCompletenessValidator.validate(config);

    expect(result.passed).toBe(false);
    // issue-analyst: template missing + outputSchema missing = 2
    // codebase-scout: template missing + not in registry = 2
    expect(result.errors).toHaveLength(4);
  });

  it('should check exists() with the correct template path', async () => {
    setAgentDefinitions([
      fakeAgent({ name: 'issue-analyst', templateFile: 'issue-analyst.md' }),
    ]);
    setRegistry({
      'issue-analyst': { phase: 1, outputFile: () => '', inputFiles: async () => [] },
    });
    vi.mocked(exists).mockResolvedValue(true);

    await registryCompletenessValidator.validate(config);

    expect(exists).toHaveBeenCalledTimes(1);
    const calledPath = vi.mocked(exists).mock.calls[0][0];
    expect(calledPath).toContain('issue-analyst.md');
    expect(calledPath).toContain('templates');
  });

  it('should return empty warnings array', async () => {
    setAgentDefinitions([fakeAgent()]);
    setRegistry({ 'issue-analyst': { phase: 1, outputFile: () => '', inputFiles: async () => [] } });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await registryCompletenessValidator.validate(config);

    expect(result.warnings).toEqual([]);
  });
});
