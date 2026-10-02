import { defineConfig } from 'vitest/config';

/** `npm run perf`: the timing test on three busy years. Not part of `npm test` (see vitest.config.ts). */
export default defineConfig({
  test: {
    include: ['apps/server/perf/**/*.perf.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
