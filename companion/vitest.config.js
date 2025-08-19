/* eslint-env node */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['src/__tests__/**/*.{test,spec}.js', 'node'],
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      enabled: process.env.CI === 'true' || process.env.VITEST_COVERAGE === 'true',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['public/**/*.js'],
      exclude: ['public/__tests__/**'],
      thresholds: {
        lines: 60,
        functions: 50,
        branches: 40,
        statements: 60,
      },
    },
  },
});
