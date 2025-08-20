/* eslint-env node */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    testTimeout: 15000,
    hookTimeout: 15000,
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      enabled: process.env.CI === 'true' || process.env.VITEST_COVERAGE === 'true',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['public/**/*.js'],
      exclude: [
        'public/__tests__/**',
        // Exclude non-controller runtime/legacy files not in current testing scope
        'public/player.js',
        'public/sw.js',
        'public/sw.controller.js',
        'public/ai.js',
        'public/ai.controller.js',
        'public/deals.js',
        'public/guard.js',
        'public/top.entry.js',
      ],
      thresholds: {
        lines: 60,
        functions: 50,
        branches: 40,
        statements: 60,
      },
    },
  },
  projects: [
    {
      name: 'node',
      test: {
        environment: 'node',
        include: [
          'src/__tests__/**/*.{test,spec}.js',
          'src/__tests__/**/*.sqlite.test.js',
          'src/__tests__/sqlite.reset.test.js',
        ],
      },
    },
    {
      name: 'ui',
      test: {
        environment: 'jsdom',
        include: ['public/__tests__/**/*.{test,spec}.js'],
      },
    },
  ],
});
