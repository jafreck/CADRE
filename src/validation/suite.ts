import type { CadreConfig } from '../config/schema.js';
import type { PreRunValidator } from './types.js';

export class PreRunValidationSuite {
  constructor(private readonly validators: PreRunValidator[]) {}

  async run(config: CadreConfig): Promise<boolean> {
    const results = await Promise.allSettled(
      this.validators.map((v) => v.validate(config).then((r) => ({ validator: v, result: r }))),
    );

    let allPassed = true;

    for (const settled of results) {
      if (settled.status === 'rejected') {
        console.log(`❌ (unknown validator)`);
        console.log(`  ${settled.reason}`);
        allPassed = false;
        continue;
      }

      const { validator, result } = settled.value;

      if (!result.passed) {
        allPassed = false;
        console.log(`❌ ${validator.name}`);
      } else if (result.warnings.length > 0) {
        console.log(`⚠️  ${validator.name}`);
      } else {
        console.log(`✅ ${validator.name}`);
      }

      for (const err of result.errors) {
        console.log(`  ${err}`);
      }
      for (const warn of result.warnings) {
        console.log(`  ${warn}`);
      }
    }

    return allPassed;
  }
}
