import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:8788',
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    screenshot: 'on',
    trace: 'on',
  },

  outputDir: './e2e/test-results',

  projects: [
    {
      name: 'production',
      testMatch: 'production.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'consumption',
      testMatch: 'consumption.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'walkthrough',
      testMatch: 'walkthrough.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'styles',
      testMatch: 'styles.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'persistence',
      testMatch: 'persistence.spec.ts',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile',
      testMatch: 'mobile.spec.ts',
      dependencies: ['consumption'], // mobile needs seeded data from consumption
      use: {
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        video: { mode: 'on', size: { width: 375, height: 812 } },
      },
    },
  ],
});
