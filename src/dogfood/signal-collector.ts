import type { DogfoodSignal } from './types.js';

/**
 * Accumulates dogfood signals in memory during a pipeline run.
 * Always records regardless of `dogfood.enabled`.
 */
export class SignalCollector {
  private signals: DogfoodSignal[] = [];

  record(signal: DogfoodSignal): void {
    this.signals.push(signal);
  }

  getSignals(): DogfoodSignal[] {
    return [...this.signals];
  }

  clear(): void {
    this.signals = [];
  }
}
