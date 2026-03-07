import type { PreRunValidator } from './types.js';

export interface ValidationSuiteOutput {
  log(message: string): void;
  error(message: string): void;
}

const consoleOutput: ValidationSuiteOutput = {
  log: (msg) => console.log(msg),
  error: (msg) => console.error(msg),
};

export class PreRunValidationSuite<TConfig = unknown> {
  private readonly output: ValidationSuiteOutput;

  constructor(
    private readonly validators: PreRunValidator<TConfig>[],
    output?: ValidationSuiteOutput,
  ) {
    this.output = output ?? consoleOutput;
  }

  async run(config: TConfig): Promise<boolean> {
    const results = await Promise.allSettled(
      this.validators.map((v) => v.validate(config).then((r) => ({ validator: v, result: r }))),
    );

    let allPassed = true;

    for (const settled of results) {
      if (settled.status === 'rejected') {
        this.output.log(`❌ (unknown validator)`);
        this.output.log(`  ${settled.reason}`);
        allPassed = false;
        continue;
      }

      const { validator, result } = settled.value;

      if (!result.passed) {
        allPassed = false;
        this.output.log(`❌ ${validator.name}`);
      } else if (result.warnings.length > 0) {
        this.output.log(`⚠️  ${validator.name}`);
      } else {
        this.output.log(`✅ ${validator.name}`);
      }

      for (const err of result.errors) {
        this.output.log(`  ${err}`);
      }
      for (const warn of result.warnings) {
        this.output.log(`  ${warn}`);
      }
    }

    return allPassed;
  }
}
