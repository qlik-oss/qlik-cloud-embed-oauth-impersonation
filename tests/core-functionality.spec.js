import { test, expect } from '@playwright/test';

// Helper: log in and land on the home page
async function login(page) {
  await page.goto('/login');
  await page.waitForSelector('#loginButton:not([disabled])', { timeout: 15000 });
  await page.click('#loginButton');
  await page.waitForURL('/', { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Core App Functionality', () => {
  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(60000);

    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Console Error: ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      console.log(`Page Error: ${error.message}`);
    });
  });

  test('should handle authentication flow', async ({ page }) => {
    // Unauthenticated access should redirect to login
    await page.goto('/');
    await page.waitForURL('/login', { timeout: 10000 });
    console.log('PASS: Unauthenticated access redirected to login');

    // Successful login redirects to home
    await page.waitForSelector('#loginButton:not([disabled])', { timeout: 15000 });
    await page.click('#loginButton');
    await page.waitForURL('/', { timeout: 20000 });
    console.log('PASS: Successfully logged in');

    // Logout redirects back to login
    await page.click('#navbarDropdown');
    await page.click('a[href="/logout"]');
    await page.waitForURL('/login', { timeout: 10000 });
    console.log('PASS: Successfully logged out');
  });

  test('should navigate between Qlik sections', async ({ page }) => {
    await login(page);

    const sections = [
      { href: '#sheet-nav', name: 'Lightweight Sheet' },
      { href: '#analytics-chart', name: 'Lightweight Chart' },
      { href: '#agentic-assistant', name: 'Agentic Assistant' },
      { href: '#ai-assistant', name: 'AI Assistant (legacy)' },
      { href: '#on-the-fly', name: 'On-the-fly Chart' },
      { href: '#analytics-chart-data', name: 'Raw Dataset' },
      { href: '#field', name: 'Filterable Field' },
      { href: '#classic-app', name: 'Classic App' },
      { href: '#classic-chart', name: 'Legacy Charts' },
    ];

    for (const section of sections) {
      console.log(`Testing navigation to: ${section.name}`);
      await page.click(`a[href="${section.href}"]`);
      const sectionId = section.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      console.log(`PASS: Navigated to ${section.name}`);
    }
  });

  test('should display data panel with refresh functionality', async ({ page }) => {
    await login(page);

    await page.click('a[href="#analytics-chart-data"]');
    await expect(page.locator('#analytics-chart-data')).toBeVisible();

    // Data panel card structure
    await expect(page.locator('.data-panel')).toBeVisible();
    await expect(page.locator('.data-panel-header')).toBeVisible();
    console.log('PASS: Data panel card is rendered');

    // Info banner explaining REST-call behaviour
    const infoBanner = page.locator('.data-panel-info');
    await expect(infoBanner).toBeVisible();
    await expect(infoBanner).toContainText('server-side REST call');
    console.log('PASS: Info banner is visible');

    // Home runs updateTable() on DOMContentLoaded; the button stays disabled until
    // hypercube + user fetch finish. Wait for the table before asserting enabled
    // (WebKit is often slower than Chromium here).
    const refreshBtn = page.locator('#refresh-data-btn');
    await expect(refreshBtn).toBeVisible();
    await expect(page.locator('#chart-data table')).toBeAttached({ timeout: 60000 });
    await expect(refreshBtn).toBeEnabled({ timeout: 30000 });
    await expect(refreshBtn).toContainText('Refresh data');
    console.log('PASS: Refresh button is enabled');

    console.log('PASS: Initial data loaded');

    // Session badge should now show user information
    const badge = page.locator('#data-session-user');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('User information:');
    console.log('PASS: Session badge displays user information');

    // Timestamp should be present after load
    const timestamp = page.locator('#data-last-refreshed');
    await expect(timestamp).toContainText('Updated');
    const firstTimestamp = await timestamp.textContent();
    console.log(`PASS: Timestamp displayed — ${firstTimestamp}`);

    // Click refresh and verify loading state
    await refreshBtn.click();
    await expect(refreshBtn).toBeDisabled();
    await expect(refreshBtn).toContainText('Refreshing');
    console.log('PASS: Button enters loading state');

    // After refresh completes, button re-enables and timestamp updates
    await expect(refreshBtn).toBeEnabled({ timeout: 30000 });
    await expect(refreshBtn).toContainText('Refresh data');
    await expect(page.locator('#chart-data table')).toBeAttached();
    await expect(timestamp).not.toHaveText(firstTimestamp ?? '', { timeout: 30000 });
    const secondTimestamp = await timestamp.textContent();
    console.log(
      `PASS: Refresh completed — timestamp updated from ${firstTimestamp} to ${secondTimestamp}`
    );
  });
});
