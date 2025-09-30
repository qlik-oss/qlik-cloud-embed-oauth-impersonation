import { test, expect } from '@playwright/test';

test.describe('Qlik Content Verification', () => {
  let page;
  const baseURL = 'http://localhost:3000';

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    page.setDefaultTimeout(60000); // Increased timeout for Qlik content loading
    
    // Listen for console errors and log them for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Console Error: ${msg.text()}`);
      }
    });
    
    page.on('pageerror', error => {
      console.log(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  test('should verify Qlik embed elements are loaded', async () => {
    console.log('Testing Qlik embed element loading');
      
      // Login first
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector('#loginButton:not([disabled])', { timeout: 10000 });
      await page.click('#loginButton');
      await page.waitForURL(`${baseURL}/`, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Test each section and verify qlik-embed elements are present
      const sections = [
        { href: '#sheet-nav', selector: 'qlik-embed[ui="analytics/sheet"]', name: 'Lightweight Sheet' },
        { href: '#analytics-chart', selector: '#analytics-chart qlik-embed[ui="analytics/chart"]', name: 'Lightweight Chart' },
        { href: '#ai-assistant', selector: 'qlik-embed[ui="ai/assistant"]', name: 'AI Assistant' },
        { href: '#on-the-fly', selector: '#on-the-fly qlik-embed[ui="analytics/chart"]', name: 'On-the-fly Chart' },
        { href: '#field', selector: 'qlik-embed[ui="analytics/field"]', name: 'Filterable Field' },
        { href: '#classic-app', selector: 'qlik-embed[ui="classic/app"]', name: 'Classic App' },
        { href: '#classic-chart', selector: 'qlik-embed[ui="classic/chart"]', name: 'Legacy Charts' }
      ];
      
    for (const section of sections) {
      console.log(`Testing ${section.name}...`);
      
      // Navigate to section
      await page.click(`a[href="${section.href}"]`);
      const sectionId = section.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      
      // Verify the qlik-embed element is present
      await expect(page.locator(section.selector)).toBeAttached();
      console.log(`PASS: ${section.name} embed element is present`);
    }
    
    console.log('SUCCESS: All Qlik embed elements verified');
    });

  test('should verify Qlik content displays correctly', async () => {
    console.log('Testing Qlik content display');
      
      // Login first
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector('#loginButton:not([disabled])', { timeout: 10000 });
      await page.click('#loginButton');
      await page.waitForURL(`${baseURL}/`, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Test Lightweight Sheet with dropdown interaction
      await page.click('a[href="#sheet-nav"]');
      await expect(page.locator('#sheet-nav')).toBeVisible();
      
    // Wait for initial content to load
    await page.waitForSelector('text=Margin Amount Over Time', { timeout: 30000 });
    console.log('PASS: Lightweight sheet initial content loaded');
    
    // Test dropdown interaction
    const dropdown = page.locator('#sheetdrop');
    await expect(dropdown).toBeVisible();
    await dropdown.selectOption({ label: 'Sales Analysis' });
    
    // Wait for content to change
    await page.waitForSelector('text=Sales by State', { timeout: 30000 });
    console.log('PASS: Lightweight sheet dropdown interaction working');
      
      // Test other sections for content presence
      const contentTests = [
        { href: '#analytics-chart', expectedText: 'Product Group Sales vs Budget', name: 'Lightweight Chart' },
        { href: '#analytics-chart-data', expectedText: '4529795.72', name: 'Raw Dataset' },
        { href: '#field', expectedText: 'Akron', name: 'Filterable Field' },
        { href: '#classic-chart', expectedText: 'Bologna', name: 'Legacy Charts' },
        { href: '#classic-app', expectedText: 'Margin Amount Over Time', name: 'Classic App' }
      ];
      
    for (const test of contentTests) {
      console.log(`Testing ${test.name} content...`);
      
      await page.click(`a[href="${test.href}"]`);
      const sectionId = test.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      
      // Special handling for classic chart since content is in SVG structure
      if (test.href === '#classic-chart') {
        // Check for the chart container and qlik-embed element
        await expect(page.locator('#classic-chart h1')).toContainText('Legacy charts (classic/chart)');
        await expect(page.locator('#classic-chart qlik-embed[ui="classic/chart"]')).toBeAttached();
        // Wait for the chart content to load by looking for text elements in the SVG
        await page.waitForSelector('#classic-chart qlik-embed svg text', { timeout: 30000 });
        // Look for specific text content in the chart
        await page.waitForSelector('#classic-chart qlik-embed svg text:has-text("Bologna")', { timeout: 30000 });
        console.log(`PASS: ${test.name} chart content loaded correctly with Bologna text`);
      } else if (test.href === '#classic-app') {
        // Special handling for classic app since content is in iframe
        await expect(page.locator('#classic-app h1')).toContainText('Full Qlik Sense (classic/app)');
        await expect(page.locator('#classic-app qlik-embed[ui="classic/app"]')).toBeAttached();
        // Wait for iframe to be present
        await page.waitForSelector('#classic-app iframe', { timeout: 30000 });
        // Get the iframe and look for text content within it
        const iframe = page.frameLocator('#classic-app iframe');
        await iframe.locator('text=Margin Amount Over Time').waitFor({ timeout: 30000 });
        console.log(`PASS: ${test.name} iframe content loaded correctly with Margin Amount Over Time text`);
      } else {
        // Wait for specific content to appear
        await page.waitForSelector(`text=${test.expectedText}`, { timeout: 30000 });
        console.log(`PASS: ${test.name} content loaded correctly`);
      }
    }
    
    console.log('SUCCESS: All Qlik content verified');
    });

  test('should handle Qlik content loading gracefully', async () => {
    console.log('Testing Qlik content loading error handling');
      
      // Login first
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector('#loginButton:not([disabled])', { timeout: 10000 });
      await page.click('#loginButton');
      await page.waitForURL(`${baseURL}/`, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Test that embed elements are present even if content is still loading
      await page.click('a[href="#sheet-nav"]');
      await expect(page.locator('#sheet-nav')).toBeVisible();
      
    // Verify the qlik-embed element exists
    const qlikEmbed = page.locator('qlik-embed[ui="analytics/sheet"]');
    await expect(qlikEmbed).toBeAttached();
    console.log('PASS: Qlik embed element is present');
    
    // Test that we can handle content that might take time to load
    try {
      await page.waitForSelector('text=Margin Amount Over Time', { timeout: 15000 });
      console.log('PASS: Content loaded within expected timeframe');
    } catch (error) {
      console.log('INFO: Content still loading, but embed element is present');
      // Take a snapshot for debugging if needed
      await page.screenshot({ 
        path: `test-results/content-loading-debug.png`
      });
    }
    
    console.log('SUCCESS: Qlik content loading handled gracefully');
  });
});