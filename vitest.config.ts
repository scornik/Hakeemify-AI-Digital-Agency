import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/contract',
      'packages/library',
      'packages/gate',
      'packages/db',
      'packages/pipeline',
    ],
  },
});
