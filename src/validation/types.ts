import type { RuntimeConfig } from '../config/loader.js';

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface PreRunValidator {
  name: string;
  validate(config: RuntimeConfig): Promise<ValidationResult>;
}
