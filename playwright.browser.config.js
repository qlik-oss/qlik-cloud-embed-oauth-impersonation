import { defineConfig, devices } from '@playwright/test';

/**
 * Hermetic browser tests (tests/browser): the real pages and Express app, with
 * @qlik/api stubbed on the server and the qlik-embed / Bootstrap CDN scripts blocked
 * in the browser. No .env or Qlik Cloud tenant is needed, so CI runs these on every PR.
 *
 * The live end-to-end tests use playwright.config.js instead.
 */
const PORT = Number(process.env.STUB_PORT || 3100);

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report-browser', open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node tests/browser/stub-server.js',
    url: `http://localhost:${PORT}/login`,
    env: { STUB_PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
