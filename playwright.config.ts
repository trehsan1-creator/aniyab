import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright is only used for the smoke test; it is not a dependency of the app
 * (the runtime bundle never sees it). Install browsers once with:
 *   npx playwright install --with-deps chromium
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'fa-IR',
    ...devices['Pixel 7'],
  },
  // Set E2E_NO_SERVER=1 when a server is already running (CI matrix, demos).
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
