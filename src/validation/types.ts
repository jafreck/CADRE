import type { CadreConfig } from '../config/schema.js';

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface PreRunValidator {
  name: string;
  validate(config: CadreConfig): Promise<ValidationResult>;
}
