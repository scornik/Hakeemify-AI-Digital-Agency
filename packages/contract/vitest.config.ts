import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/**', 'src/**/index.ts'],
      thresholds: {
        // P1's definition of done: the predicate grammar is fully branch-covered. It is the
        // one component every eligibility decision passes through, so a missed branch here is
        // a silently wrong eligible set rather than a crash.
        'src/predicate/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
