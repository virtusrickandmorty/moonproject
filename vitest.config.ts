import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    // Every test database runs all the migrations first (over 150 now), so the longest property tests need more than 20 s on
    // a busy CI runner; one that hangs still fails.
    testTimeout: 40000,
  },
});
