import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';
import type { AgentName } from '../src/agents/types.js';

const ALL_AGENT_NAMES: AgentName[] = [
  'issue-analyst',
  'codebase-scout',
  'dependency-analyst',
  'implementation-planner',
  'adjudicator',
  'code-writer',
  'test-writer',
  'code-reviewer',
  'fix-surgeon',
  'integration-checker',
  'pr-composer',
];

describe('AGENT_DEFINITIONS', () => {
  it('should contain exactly 13 entries', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(13);
  });

  it('should have one entry for each AgentName', () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name);
    for (const agentName of ALL_AGENT_NAMES) {
      expect(names).toContain(agentName);
    }
  });

  it('should have no duplicate agent names', () => {
    const names = AGENT_DEFINITIONS.map((d) => d.name);
    const unique = new Set(names);
    expect(unique.size).toBe(AGENT_DEFINITIONS.length);
  });

  it('should have non-empty required fields for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.phaseName).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.templateFile).toBeTruthy();
      expect(typeof def.phase).toBe('number');
      expect(typeof def.hasStructuredOutput).toBe('boolean');
    }
  });

  it('should have templateFile matching pattern <name>.md for every entry', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.templateFile).toBe(`${def.name}.md`);
    }
  });

  it('should have valid phase numbers (0-5)', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def.phase).toBeGreaterThanOrEqual(0);
      expect(def.phase).toBeLessThanOrEqual(5);
    }
  });

  it('should mark structured-output agents correctly', () => {
    const structured = AGENT_DEFINITIONS.filter((d) => d.hasStructuredOutput).map((d) => d.name);
    expect(structured).toContain('issue-analyst');
    expect(structured).toContain('codebase-scout');
    expect(structured).toContain('implementation-planner');
    expect(structured).toContain('adjudicator');
    expect(structured).toContain('code-reviewer');
    expect(structured).toContain('integration-checker');
    expect(structured).toContain('pr-composer');
  });

  it('should mark non-structured-output agents correctly', () => {
    const unstructured = AGENT_DEFINITIONS.filter((d) => !d.hasStructuredOutput).map((d) => d.name);
    expect(unstructured).toContain('code-writer');
    expect(unstructured).toContain('test-writer');
    expect(unstructured).toContain('fix-surgeon');
    expect(unstructured).toContain('conflict-resolver');
  });

  it('should group analysis agents in phase 1', () => {
    const phase1 = AGENT_DEFINITIONS.filter((d) => d.phase === 1).map((d) => d.name);
    expect(phase1).toContain('issue-analyst');
    expect(phase1).toContain('codebase-scout');
    for (const def of AGENT_DEFINITIONS.filter((d) => d.phase === 1)) {
      expect(def.phaseName).toBe('Analysis & Scouting');
    }
  });

  it('should group planning agents in phase 2', () => {
    const phase2 = AGENT_DEFINITIONS.filter((d) => d.phase === 2).map((d) => d.name);
    expect(phase2).toContain('implementation-planner');
    expect(phase2).toContain('adjudicator');
    for (const def of AGENT_DEFINITIONS.filter((d) => d.phase === 2)) {
      expect(def.phaseName).toBe('Planning');
    }
  });

  it('should group implementation agents in phase 3', () => {
    const phase3 = AGENT_DEFINITIONS.filter((d) => d.phase === 3).map((d) => d.name);
    expect(phase3).toContain('code-writer');
    expect(phase3).toContain('test-writer');
    expect(phase3).toContain('code-reviewer');
    expect(phase3).toContain('fix-surgeon');
    for (const def of AGENT_DEFINITIONS.filter((d) => d.phase === 3)) {
      expect(def.phaseName).toBe('Implementation');
    }
  });

  it('should have integration-checker in phase 4', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'integration-checker');
    expect(def?.phase).toBe(4);
    expect(def?.phaseName).toBe('Integration Verification');
  });

  it('should have pr-composer in phase 5', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'pr-composer');
    expect(def?.phase).toBe(5);
    expect(def?.phaseName).toBe('PR Composition');
  });

  it('should have dependency-analyst with correct metadata', () => {
    const def = AGENT_DEFINITIONS.find((d) => d.name === 'dependency-analyst');
    expect(def).toBeDefined();
    expect(def?.phase).toBe(1);
    expect(def?.phaseName).toBe('Analysis & Scouting');
    expect(def?.hasStructuredOutput).toBe(true);
    expect(def?.templateFile).toBe('dependency-analyst.md');
  });
});
