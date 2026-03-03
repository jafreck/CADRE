import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger, CostEstimator, FleetEventBus } from '@cadre/framework/core';
import { NotificationManager } from '@cadre/framework/notifications';
import { SessionQueue, ParallelExecutor, RetryExecutor } from '@cadre/framework/engine';
import { PreRunValidationSuite, diskValidator } from '@cadre/framework/core';
import { defineFlow, step, loop, parallel, conditional, gate, FlowRunner, fromStep, fromContext, fromSteps } from '@cadre/framework/flow';

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('package boundary usage', () => {
  it('exports extracted framework package APIs', () => {
    expect(Logger).toBeTypeOf('function');
    expect(CostEstimator).toBeTypeOf('function');
    expect(FleetEventBus).toBeTypeOf('function');

    expect(NotificationManager).toBeTypeOf('function');

    expect(SessionQueue).toBeTypeOf('function');
    expect(ParallelExecutor).toBeTypeOf('function');
    expect(RetryExecutor).toBeTypeOf('function');

    expect(PreRunValidationSuite).toBeTypeOf('function');
    expect(diskValidator.name).toBe('disk');

    expect(defineFlow).toBeTypeOf('function');
    expect(step).toBeTypeOf('function');
    expect(loop).toBeTypeOf('function');
    expect(parallel).toBeTypeOf('function');
    expect(conditional).toBeTypeOf('function');
    expect(gate).toBeTypeOf('function');
    expect(fromStep).toBeTypeOf('function');
    expect(fromContext).toBeTypeOf('function');
    expect(fromSteps).toBeTypeOf('function');
    expect(FlowRunner).toBeTypeOf('function');
  });

  it('does not use src-relative imports for extracted modules in production code', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files = walkTsFiles(srcRoot);

    const forbiddenPatterns = [
      "from './logging/",
      "from '../logging/",
      "from './notifications/",
      "from '../notifications/",
      "from './execution/",
      "from '../execution/",
      "from './validation/types.js'",
      "from '../validation/types.js'",
      "from './validation/suite.js'",
      "from '../validation/suite.js'",
      "from './validation/disk-validator.js'",
      "from '../validation/disk-validator.js'",
      "from './validation/index.js'",
      "from '../validation/index.js'",
    ];

    const violations: string[] = [];

    for (const file of files) {
      const rel = file.replace(`${process.cwd()}/`, '');
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push(`${rel}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
