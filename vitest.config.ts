import { defineConfig } from 'vitest/config';

export default defineConfig({
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
