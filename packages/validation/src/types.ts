export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface PreRunValidator<TConfig = unknown> {
  name: string;
  validate(config: TConfig): Promise<ValidationResult>;
}
