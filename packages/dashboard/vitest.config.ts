import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '@ada/dashboard', include: ['tests/**/*.test.ts'], exclude: ['**/dist/**'] },
});
