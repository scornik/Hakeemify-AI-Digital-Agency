import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@ada/harvest', include: ['tests/**/*.test.ts'], exclude: ['**/dist/**'] },
});
