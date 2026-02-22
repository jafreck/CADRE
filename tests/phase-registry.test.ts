import { describe, it, expect } from 'vitest';
import {
  ISSUE_PHASES,
  getPhase,
  getPhaseCount,
  isLastPhase,
} from '../src/core/phase-registry.js';

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

    it('should have phases 4-5 as non-critical', () => {
      expect(ISSUE_PHASES[3].critical).toBe(false);
      expect(ISSUE_PHASES[4].critical).toBe(false);
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
});
