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
      { href: '#ai-assistant', name: 'AI Assistant' },
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
});
