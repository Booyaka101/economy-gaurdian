/* eslint-env node */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      enabled: process.env.CI === 'true' || process.env.VITEST_COVERAGE === 'true',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['public/**/*.js'],
      exclude: ['public/__tests__/**'],
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
      },
    },
  },
});
