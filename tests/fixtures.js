import { test as base, expect } from '@playwright/test';

/**
 * Log in once per worker through the real login page and reuse the session cookies
 * in every test that imports `test` from this file. Logging in per test made a full
 * run close to the server's login rate limit (40 per 15 minutes per IP).
 *
 * Tests that need to exercise login/logout themselves should opt out with
 * `test.use({ storageState: { cookies: [], origins: [] } })`.
 */
export const test = base.extend({
  workerStorageState: [async ({ browser }, use, workerInfo) => {
    const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
    await page.goto('/login');
    await page.waitForSelector('#loginButton:not([disabled])', { timeout: 15000 });
    await page.click('#loginButton');
    await page.waitForURL('/', { timeout: 30000 });
    const state = await page.context().storageState();
    await page.close();
    await use(state);
  }, { scope: 'worker' }],

  storageState: ({ workerStorageState }, use) => use(workerStorageState),
});

/** Open the home page with the shared session (GET / re-runs user provisioning). */
export async function openHome(page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded');
}

export { expect };
