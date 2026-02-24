import type { CadreConfig } from '../config/schema.js';

/**
 * Returns true when cadre is running against its own repository (jafreck/cadre).
 * Comparison is case-insensitive.
 */
export function isCadreSelfRun(config: CadreConfig): boolean {
  return (config.repository ?? '').toLowerCase() === 'jafreck/cadre';
}
