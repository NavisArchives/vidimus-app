import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa/visual',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: {
    timeout: 12_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.015,
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'qa/visual/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8794',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
});
