import { test, expect } from '@playwright/test';

test.describe('Core App Functionality', () => {
  const baseURL = 'http://localhost:3000';

  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(30000);
    
    // Listen for console errors and log them
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
    console.log('Testing authentication flow');
    
    // Test unauthenticated access redirects to login
    await page.goto(`${baseURL}/`);
    await page.waitForURL(`${baseURL}/login`, { timeout: 10000 });
    console.log('PASS: Unauthenticated access redirected to login');
    
    // Test login functionality
    await page.waitForSelector('#loginButton:not([disabled])', { timeout: 10000 });
    await page.click('#loginButton');
    await page.waitForURL(`${baseURL}/`, { timeout: 15000 });
    console.log('PASS: Successfully logged in');
    
    // Test logout functionality
    await page.click('#navbarDropdown');
    await page.click('a[href="/logout"]');
    await page.waitForURL(`${baseURL}/login`, { timeout: 10000 });
    console.log('PASS: Successfully logged out');
    
    console.log('SUCCESS: Authentication flow working correctly');
  });

  test('should navigate between Qlik sections', async ({ page }) => {
    console.log('Testing section navigation');
    
    // Login first
    await page.goto(`${baseURL}/login`);
    await page.waitForSelector('#loginButton:not([disabled])', { timeout: 10000 });
    await page.click('#loginButton');
    await page.waitForURL(`${baseURL}/`, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    
    // Test navigation to each Qlik section
    const sections = [
      { href: '#sheet-nav', name: 'Lightweight Sheet' },
      { href: '#analytics-chart', name: 'Lightweight Chart' },
      { href: '#ai-assistant', name: 'AI Assistant' },
      { href: '#on-the-fly', name: 'On-the-fly Chart' },
      { href: '#analytics-chart-data', name: 'Raw Dataset' },
      { href: '#field', name: 'Filterable Field' },
      { href: '#classic-app', name: 'Classic App' },
      { href: '#classic-chart', name: 'Legacy Charts' }
    ];
    
    for (const section of sections) {
      console.log(`Testing navigation to: ${section.name}`);
      
      await page.click(`a[href="${section.href}"]`);
      const sectionId = section.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      
      console.log(`PASS: Successfully navigated to ${section.name}`);
    }
    
    console.log('SUCCESS: All section navigation working correctly');
  });
});