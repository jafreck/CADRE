import type { CadreConfig } from "../config/schema.js";

export interface ValidationResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
  name?: string;
}

export interface PreRunValidator {
  name: string;
  validate(config: CadreConfig): Promise<ValidationResult>;
}
