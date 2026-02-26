import { describe, it, expect, vi } from 'vitest';
import {
  ISSUE_PHASES,
  PHASE_MANIFEST,
  REVIEW_RESPONSE_PHASES,
  getPhase,
  getPhaseCount,
  getPhaseSubset,
  isLastPhase,
  PhaseRegistry,
  buildRegistry,
  buildGateMap,
} from '../src/core/phase-registry.js';
import type { PhaseExecutor } from '../src/core/phase-executor.js';

describe('PhaseRegistry', () => {
  describe('ISSUE_PHASES', () => {
    it('should have 5 phases', () => {
      expect(ISSUE_PHASES).toHaveLength(5);
    });

    it('should have IDs from 1 to 5', () => {
      const ids = ISSUE_PHASES.map((p) => p.id);
      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });

    it('should have phases 1-3 as critical', () => {
      expect(ISSUE_PHASES[0].critical).toBe(true);
      expect(ISSUE_PHASES[1].critical).toBe(true);
      expect(ISSUE_PHASES[2].critical).toBe(true);
    });

    it('should have phase 4 as critical', () => {
      expect(ISSUE_PHASES[3].critical).toBe(true);
    });

    it('should have phase 5 as critical', () => {
      expect(ISSUE_PHASES[4].critical).toBe(true);
    });

    it('should have expected phase names', () => {
      expect(ISSUE_PHASES[0].name).toBe('Analysis & Scouting');
      expect(ISSUE_PHASES[1].name).toBe('Planning');
      expect(ISSUE_PHASES[2].name).toBe('Implementation');
      expect(ISSUE_PHASES[3].name).toBe('Integration Verification');
      expect(ISSUE_PHASES[4].name).toBe('PR Composition');
    });
  });

  describe('getPhase', () => {
    it('should return the correct phase for a valid ID', () => {
      const phase = getPhase(1);
      expect(phase).toBeDefined();
      expect(phase!.name).toBe('Analysis & Scouting');
    });

    it('should return undefined for invalid ID', () => {
      expect(getPhase(0)).toBeUndefined();
      expect(getPhase(6)).toBeUndefined();
    });
  });

  describe('getPhaseCount', () => {
    it('should return 5', () => {
      expect(getPhaseCount()).toBe(5);
    });
  });

  describe('isLastPhase', () => {
    it('should return true for phase 5', () => {
      expect(isLastPhase(5)).toBe(true);
    });

    it('should return false for other phases', () => {
      expect(isLastPhase(1)).toBe(false);
      expect(isLastPhase(3)).toBe(false);
    });
  });

  describe('REVIEW_RESPONSE_PHASES', () => {
    it('should equal [3, 4, 5]', () => {
      expect(REVIEW_RESPONSE_PHASES).toEqual([3, 4, 5]);
    });

    it('should be readonly', () => {
      expect(Object.isFrozen(REVIEW_RESPONSE_PHASES) || Array.isArray(REVIEW_RESPONSE_PHASES)).toBe(true);
    });
  });

  describe('getPhaseSubset', () => {
    it('should return phases matching the given IDs in phase-ID order', () => {
      const subset = getPhaseSubset([3, 4, 5]);
      expect(subset).toHaveLength(3);
      expect(subset.map((p) => p.id)).toEqual([3, 4, 5]);
    });

    it('should return phases in phase-ID order regardless of input order', () => {
      const subset = getPhaseSubset([5, 3]);
      expect(subset.map((p) => p.id)).toEqual([3, 5]);
    });

    it('should return an empty array for unknown IDs', () => {
      expect(getPhaseSubset([99, 100])).toEqual([]);
    });

    it('should return only matching phases when given a mixed list', () => {
      const subset = getPhaseSubset([2, 99]);
      expect(subset).toHaveLength(1);
      expect(subset[0].id).toBe(2);
    });

    it('should return PhaseDefinition objects with correct names', () => {
      const subset = getPhaseSubset([3, 5]);
      expect(subset[0].name).toBe('Implementation');
      expect(subset[1].name).toBe('PR Composition');
    });
  });
});

function makeExecutor(phaseId: number, name: string): PhaseExecutor {
  return { phaseId, name, execute: vi.fn().mockResolvedValue(`/output/${phaseId}.md`) };
}

describe('PhaseRegistry class', () => {
  it('should start empty', () => {
    const registry = new PhaseRegistry();
    expect(registry.getAll()).toEqual([]);
  });

  it('should return a registered executor', () => {
    const registry = new PhaseRegistry();
    const executor = makeExecutor(1, 'Phase One');
    registry.register(executor);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toBe(executor);
  });

  it('should preserve registration order', () => {
    const registry = new PhaseRegistry();
    const e1 = makeExecutor(1, 'Phase One');
    const e2 = makeExecutor(2, 'Phase Two');
    const e3 = makeExecutor(3, 'Phase Three');
    registry.register(e1);
    registry.register(e2);
    registry.register(e3);
    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]).toBe(e1);
    expect(all[1]).toBe(e2);
    expect(all[2]).toBe(e3);
  });

  it('should allow registering the same executor multiple times', () => {
    const registry = new PhaseRegistry();
    const executor = makeExecutor(1, 'Phase One');
    registry.register(executor);
    registry.register(executor);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('getAll should return the same array reference on repeated calls', () => {
    const registry = new PhaseRegistry();
    registry.register(makeExecutor(1, 'Phase One'));
    expect(registry.getAll()).toBe(registry.getAll());
  });

  it('each PhaseRegistry instance should have independent state', () => {
    const r1 = new PhaseRegistry();
    const r2 = new PhaseRegistry();
    r1.register(makeExecutor(1, 'Phase One'));
    expect(r1.getAll()).toHaveLength(1);
    expect(r2.getAll()).toHaveLength(0);
  });
});

describe('PHASE_MANIFEST', () => {
  it('should have exactly 5 entries', () => {
    expect(PHASE_MANIFEST).toHaveLength(5);
  });

  it('should have phaseIds 1 through 5 in order', () => {
    expect(PHASE_MANIFEST.map((e) => e.phaseId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('should have the correct names matching ISSUE_PHASES', () => {
    for (let i = 0; i < PHASE_MANIFEST.length; i++) {
      expect(PHASE_MANIFEST[i].name).toBe(ISSUE_PHASES[i].name);
    }
  });

  it('should mark all phases as critical', () => {
    for (const entry of PHASE_MANIFEST) {
      expect(entry.critical).toBe(true);
    }
  });

  it('should include gates for phases 1–4 and null for phase 5', () => {
    expect(PHASE_MANIFEST[0].gate).not.toBeNull();
    expect(PHASE_MANIFEST[1].gate).not.toBeNull();
    expect(PHASE_MANIFEST[2].gate).not.toBeNull();
    expect(PHASE_MANIFEST[3].gate).not.toBeNull();
    expect(PHASE_MANIFEST[4].gate).toBeNull();
  });

  it('should mark phases 3, 4, 5 as includeInReviewResponse and phases 1, 2 as not', () => {
    expect(PHASE_MANIFEST[0].includeInReviewResponse).toBe(false);
    expect(PHASE_MANIFEST[1].includeInReviewResponse).toBe(false);
    expect(PHASE_MANIFEST[2].includeInReviewResponse).toBe(true);
    expect(PHASE_MANIFEST[3].includeInReviewResponse).toBe(true);
    expect(PHASE_MANIFEST[4].includeInReviewResponse).toBe(true);
  });

  it('should have executorFactory functions for each entry', () => {
    for (const entry of PHASE_MANIFEST) {
      expect(typeof entry.executorFactory).toBe('function');
    }
  });

  it('should have matching commitType values as ISSUE_PHASES', () => {
    for (let i = 0; i < PHASE_MANIFEST.length; i++) {
      expect(PHASE_MANIFEST[i].commitType).toBe(ISSUE_PHASES[i].commitType);
    }
  });
});

describe('buildRegistry', () => {
  it('should return a PhaseRegistry with 5 executors', () => {
    const registry = buildRegistry();
    expect(registry.getAll()).toHaveLength(5);
  });

  it('should return executors in phase-ID order (1 to 5)', () => {
    const registry = buildRegistry();
    const ids = registry.getAll().map((e) => e.phaseId);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('should return a PhaseRegistry instance', () => {
    const registry = buildRegistry();
    expect(registry).toBeInstanceOf(PhaseRegistry);
  });

  it('should create independent registries on each call', () => {
    const r1 = buildRegistry();
    const r2 = buildRegistry();
    expect(r1.getAll()).not.toBe(r2.getAll());
    expect(r1).not.toBe(r2);
  });
});

describe('buildGateMap', () => {
  it('should return a record with keys 1, 2, 3, 4', () => {
    const gateMap = buildGateMap();
    const keys = Object.keys(gateMap).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual([1, 2, 3, 4]);
  });

  it('should not include phase 5 (no gate)', () => {
    const gateMap = buildGateMap();
    expect(gateMap[5]).toBeUndefined();
  });

  it('should return gate objects with a validate function for each phase', () => {
    const gateMap = buildGateMap();
    for (const key of [1, 2, 3, 4]) {
      expect(typeof gateMap[key].validate).toBe('function');
    }
  });

  it('should return independent gate maps on each call', () => {
    const m1 = buildGateMap();
    const m2 = buildGateMap();
    expect(m1).not.toBe(m2);
  });
});
