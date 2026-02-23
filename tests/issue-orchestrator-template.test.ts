import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/issue-orchestrator.md');

describe('issue-orchestrator.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Issue Orchestrator heading', () => {
    expect(lines[0].trim()).toBe('# Issue Orchestrator');
  });

  it('should have at least 40 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(40);
  });

  it('should describe all 5 phases', () => {
    expect(content).toMatch(/Phase 1/);
    expect(content).toMatch(/Phase 2/);
    expect(content).toMatch(/Phase 3/);
    expect(content).toMatch(/Phase 4/);
    expect(content).toMatch(/Phase 5/);
  });

  it('should describe Phase 1 as Analysis & Scouting', () => {
    expect(content).toMatch(/Phase 1.*Analysis/i);
  });

  it('should describe Phase 2 as Planning', () => {
    expect(content).toMatch(/Phase 2.*Planning/i);
  });

  it('should describe Phase 3 as Implementation', () => {
    expect(content).toMatch(/Phase 3.*Implementation/i);
  });

  it('should describe Phase 4 as Integration Verification', () => {
    expect(content).toMatch(/Phase 4.*Integration/i);
  });

  it('should describe Phase 5 as PR Composition', () => {
    expect(content).toMatch(/Phase 5.*PR/i);
  });

  it('should list agents for each phase', () => {
    // Must mention specific agent names covering all phases
    expect(content).toMatch(/issue-analyst/);
    expect(content).toMatch(/codebase-scout/);
    expect(content).toMatch(/implementation-planner/);
    expect(content).toMatch(/code-writer/);
    expect(content).toMatch(/test-writer/);
    expect(content).toMatch(/integration-checker/);
    expect(content).toMatch(/pr-composer/);
  });

  it('should describe Inputs for each phase', () => {
    const inputMatches = [...content.matchAll(/\*\*Inputs/g)];
    expect(inputMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('should describe Outputs for each phase', () => {
    const outputMatches = [...content.matchAll(/\*\*Outputs/g)];
    expect(outputMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('should list Agents section for each phase', () => {
    const agentMatches = [...content.matchAll(/\*\*Agents/g)];
    expect(agentMatches.length).toBeGreaterThanOrEqual(5);
  });
});
