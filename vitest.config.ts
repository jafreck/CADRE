import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@cadre-dev\/framework$/, replacement: resolve(__dirname, 'packages/framework/src/index.ts') },
      {
        find: /^@cadre-dev\/framework\/(.+)$/,
        replacement: `${resolve(__dirname, 'packages/framework/src')}/$1/index.ts`,
      },
    ],
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.cadre/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.cadre/**',
        '**/tests/**',
      ],
    },
  },
});
