import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITIONS } from '../src/agents/definitions.js';
import type { AgentDefinition } from '../src/agents/definitions.js';
import type { AgentName } from '../src/agents/types.js';

const ALL_AGENT_NAMES: AgentName[] = [
  'issue-analyst',
  'codebase-scout',
  'implementation-planner',
  'adjudicator',
  'code-writer',
  'test-writer',
  'code-reviewer',
  'fix-surgeon',
  'integration-checker',
  'pr-composer',
  'issue-orchestrator',
  'cadre-runner',
];

describe('AGENT_DEFINITIONS', () => {
  it('should export exactly 12 entries', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(12);
  });

  it('should contain one entry per AgentName', () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name);
    for (const agentName of ALL_AGENT_NAMES) {
      expect(names).toContain(agentName);
    }
  });

  it('should not contain duplicate agent names', () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('should have non-empty description for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.description, `description for ${def.name}`).toBeTruthy();
      expect(def.description.trim().length, `description for ${def.name}`).toBeGreaterThan(0);
    }
  });

  it('should have a valid phase (1–7) for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.phase, `phase for ${def.name}`).toBeGreaterThanOrEqual(1);
      expect(def.phase, `phase for ${def.name}`).toBeLessThanOrEqual(7);
    }
  });

  it('should have a non-empty phaseName for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.phaseName, `phaseName for ${def.name}`).toBeTruthy();
      expect(def.phaseName.trim().length, `phaseName for ${def.name}`).toBeGreaterThan(0);
    }
  });

  it('should have templateFile of the form <name>.agent.md for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.templateFile, `templateFile for ${def.name}`).toBe(`${def.name}.agent.md`);
    }
  });

  it('should have a boolean hasStructuredOutput for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(typeof def.hasStructuredOutput, `hasStructuredOutput for ${def.name}`).toBe('boolean');
    }
  });

  it('should satisfy the AgentDefinition interface shape', () => {
    const requiredKeys: (keyof AgentDefinition)[] = [
      'name',
      'phase',
      'phaseName',
      'description',
      'hasStructuredOutput',
      'templateFile',
    ];
    for (const def of AGENT_DEFINITIONS) {
      for (const key of requiredKeys) {
        expect(def, `key ${key} missing for ${def.name}`).toHaveProperty(key);
      }
    }
  });

  it('should find issue-analyst in phase 1', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'issue-analyst');
    expect(def).toBeDefined();
    expect(def!.phase).toBe(1);
  });

  it('should find code-writer in phase 3', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'code-writer');
    expect(def).toBeDefined();
    expect(def!.phase).toBe(3);
  });

  it('should find integration-checker in phase 4', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'integration-checker');
    expect(def).toBeDefined();
    expect(def!.phase).toBe(4);
  });

  it('should find pr-composer in phase 5', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'pr-composer');
    expect(def).toBeDefined();
    expect(def!.phase).toBe(5);
  });
});
