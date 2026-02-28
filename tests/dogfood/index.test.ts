import { describe, it, expect } from 'vitest';
import {
  SignalCollector,
  TopicAggregator,
  SeverityClassifier,
  DogfoodIssueFiler,
  SEVERITY_ORDER,
} from '../../src/dogfood/index.js';

describe('dogfood barrel export', () => {
  it('should export SignalCollector', () => {
    expect(SignalCollector).toBeDefined();
  });

  it('should export TopicAggregator', () => {
    expect(TopicAggregator).toBeDefined();
  });

  it('should export SeverityClassifier', () => {
    expect(SeverityClassifier).toBeDefined();
  });

  it('should export DogfoodIssueFiler', () => {
    expect(DogfoodIssueFiler).toBeDefined();
  });

  it('should export SEVERITY_ORDER', () => {
    expect(SEVERITY_ORDER).toBeDefined();
    expect(SEVERITY_ORDER['critical']).toBe(5);
  });
});
