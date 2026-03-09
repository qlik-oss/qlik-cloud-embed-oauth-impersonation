import { test, expect } from '@playwright/test';

// Helper: log in and land on the home page
async function login(page) {
  await page.goto('/login');
  await page.waitForSelector('#loginButton:not([disabled])', { timeout: 15000 });
  await page.click('#loginButton');
  await page.waitForURL('/', { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Qlik Content Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Qlik UIs can take 30–60 s (sometimes longer) to fully render
    test.setTimeout(120000);
    page.setDefaultTimeout(90000);

    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Console Error: ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      console.log(`Page Error: ${error.message}`);
    });
  });

  // ─── Embed elements presence ───────────────────────────────────────────────

  test('should verify Qlik embed elements are loaded', async ({ page }) => {
    await login(page);

    // Sections whose qlik-embed element must be attached after navigation
    const sections = [
      { href: '#sheet-nav',          selector: 'qlik-embed[ui="analytics/sheet"]',          name: 'Lightweight Sheet' },
      { href: '#analytics-chart',    selector: '#analytics-chart qlik-embed[ui="analytics/chart"]', name: 'Lightweight Chart' },
      { href: '#on-the-fly',         selector: '#on-the-fly qlik-embed[ui="analytics/chart"]',      name: 'On-the-fly Chart' },
      { href: '#analytics-chart-data', selector: '#chart-data:not(:empty)',                           name: 'Raw Dataset' },
      { href: '#field',              selector: 'qlik-embed[ui="analytics/field"]',                  name: 'Filterable Field' },
      { href: '#classic-app',        selector: 'qlik-embed[ui="classic/app"]',                      name: 'Classic App' },
      { href: '#classic-chart',      selector: 'qlik-embed[ui="classic/chart"]',                    name: 'Legacy Charts' },
    ];

    // AI assistants may not be configured; accept either the embed or the "not configured" message

    // Agentic Assistant (ai/agentic-assistant)
    await page.click('a[href="#agentic-assistant"]');
    await expect(page.locator('#agentic-assistant')).toBeVisible();
    const agenticLocator = page.locator('qlik-embed[ui="ai/agentic-assistant"], #agentic-assistant .embed-ai');
    await expect(agenticLocator.first()).toBeAttached({ timeout: 15000 });
    console.log('PASS: Agentic Assistant section present');

    // AI Assistant — legacy (ai/assistant)
    await page.click('a[href="#ai-assistant"]');
    await expect(page.locator('#ai-assistant')).toBeVisible();
    const aiLocator = page.locator('qlik-embed[ui="ai/assistant"], #ai-assistant .embed-ai');
    await expect(aiLocator.first()).toBeAttached({ timeout: 15000 });
    console.log('PASS: AI Assistant (legacy) section present');

    for (const section of sections) {
      console.log(`Checking ${section.name}...`);
      await page.click(`a[href="${section.href}"]`);
      const sectionId = section.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      await expect(page.locator(section.selector)).toBeAttached({ timeout: 30000 });
      console.log(`PASS: ${section.name} embed element is present`);
    }
  });

  // ─── Lightweight sheet: navigate through every available sheet ─────────────

  test('should navigate between sheets in lightweight sheet experience', async ({ page }) => {
    await login(page);

    await page.click('a[href="#sheet-nav"]');
    await expect(page.locator('#sheet-nav')).toBeVisible();

    // Wait for the sheet dropdown to be populated by the API call.
    // The /app-sheets endpoint may fail if the Qlik engine is unavailable.
    const sheetsLoaded = await page.waitForFunction(
      () => (document.getElementById('sheetdrop')?.options.length ?? 0) > 0,
      { timeout: 30000 }
    ).then(() => true).catch(() => false);

    if (!sheetsLoaded) {
      console.log('SKIP: Sheet dropdown not populated — Qlik engine unavailable');
      test.skip(true, 'Qlik engine unavailable: /app-sheets returned an error');
      return;
    }
    console.log('PASS: Sheet dropdown populated');

    // Wait for the initial sheet to render
    await page.locator('#sheet-nav qlik-embed[ui="analytics/sheet"]').waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForSelector('text=Margin Amount Over Time', { timeout: 60000 });
    console.log('PASS: Initial sheet loaded (Margin Amount Over Time visible)');

    // Collect every sheet option
    const sheetOptions = await page.locator('#sheetdrop option').all();
    console.log(`Found ${sheetOptions.length} sheet(s) to navigate through`);

    // Skip index 0 — it is already loaded; start from index 1
    for (let i = 1; i < sheetOptions.length; i++) {
      const optionText  = await sheetOptions[i].textContent();
      const optionValue = await sheetOptions[i].getAttribute('value');

      console.log(`Selecting sheet ${i + 1}/${sheetOptions.length}: "${optionText}"`);
      await page.locator('#sheetdrop').selectOption({ value: optionValue });

      // The JS handler sets sheet-id on the embed when the dropdown changes
      await expect(
        page.locator(`#sheet-nav qlik-embed[sheet-id="${optionValue}"]`)
      ).toBeAttached({ timeout: 15000 });

      // Wait for the sheet to finish rendering (SVG elements appear inside the embed)
      await page.locator('#sheet-nav qlik-embed[ui="analytics/sheet"] svg').first().waitFor({
        state: 'attached',
        timeout: 60000,
      });
      console.log(`PASS: Sheet "${optionText}" rendered`);
    }

    // Navigate back to the first sheet to verify bidirectional navigation
    const firstValue = await sheetOptions[0].getAttribute('value');
    console.log('Navigating back to first sheet');
    await page.locator('#sheetdrop').selectOption({ value: firstValue });
    await expect(
      page.locator(`#sheet-nav qlik-embed[sheet-id="${firstValue}"]`)
    ).toBeAttached({ timeout: 15000 });
    await page.locator('#sheet-nav qlik-embed[ui="analytics/sheet"] svg').first().waitFor({
      state: 'attached',
      timeout: 60000,
    });
    console.log('PASS: Successfully navigated back to first sheet');
  });

  // ─── On-the-fly chart: cycle through all chart types ──────────────────────

  test('should change on-the-fly chart types and verify rendering', async ({ page }) => {
    await login(page);

    await page.click('a[href="#on-the-fly"]');
    await expect(page.locator('#on-the-fly')).toBeVisible();

    // The qlik-embed is created dynamically by JS; wait for it to appear
    const chartEmbed = page.locator('#visualization');
    await chartEmbed.waitFor({ state: 'attached', timeout: 30000 });

    // Wait for the initial barchart SVG to render
    console.log('Waiting for initial barchart to render...');
    await page.locator('#visualization svg').first().waitFor({ state: 'attached', timeout: 60000 });
    console.log('PASS: Initial barchart rendered');

    const chartTypes = [
      { value: 'piechart',  label: 'Pie chart'  },
      { value: 'linechart', label: 'Line chart' },
      { value: 'barchart',  label: 'Bar chart'  },
    ];

    for (const { value, label } of chartTypes) {
      console.log(`Switching to: ${label}`);
      await page.locator('#chartType').selectOption(value);

      // Verify the type attribute was applied to the embed element
      await expect(page.locator(`#visualization[type="${value}"]`)).toBeAttached({
        timeout: 10000,
      });

      // Wait for the chart to (re-)render with the new type
      await page.locator(`#visualization[type="${value}"] svg`).first().waitFor({
        state: 'attached',
        timeout: 60000,
      });
      console.log(`PASS: ${label} rendered correctly`);
    }
  });

  // ─── Content display: verify actual Qlik data appears on screen ───────────

  test('should verify Qlik content displays correctly', async ({ page }) => {
    await login(page);

    // Lightweight Sheet — initial sheet and dropdown navigation
    console.log('Testing Lightweight Sheet...');
    await page.click('a[href="#sheet-nav"]');
    await expect(page.locator('#sheet-nav')).toBeVisible();

    // The sheet dropdown is populated asynchronously by /app-sheets.
    // If the Qlik engine is unavailable the dropdown stays empty.
    const sheetsLoaded = await page.waitForFunction(
      () => (document.getElementById('sheetdrop')?.options.length ?? 0) > 0,
      { timeout: 30000 }
    ).then(() => true).catch(() => false);

    if (!sheetsLoaded) {
      console.log('SKIP: Sheet dropdown not populated — Qlik engine unavailable');
      test.skip(true, 'Qlik engine unavailable: /app-sheets returned an error');
      return;
    }

    await page.waitForSelector('text=Margin Amount Over Time', { timeout: 60000 });
    console.log('PASS: Initial sheet content loaded');

    await page.locator('#sheetdrop').selectOption({ label: 'Sales Analysis' });
    // Wait for the sheet embed to update its sheet-id, then verify SVG renders
    const salesAnalysisValue = await page.locator('#sheetdrop option', { hasText: 'Sales Analysis' }).getAttribute('value');
    await expect(
      page.locator(`#sheet-nav qlik-embed[sheet-id="${salesAnalysisValue}"]`)
    ).toBeAttached({ timeout: 15000 });
    await page.locator('#sheet-nav qlik-embed[ui="analytics/sheet"] svg').first().waitFor({
      state: 'attached',
      timeout: 60000,
    });
    console.log('PASS: Sheet navigation to "Sales Analysis" working');

    // Other sections — verify specific data text
    const contentTests = [
      { href: '#analytics-chart',      expectedText: 'Product Group Sales vs Budget', name: 'Lightweight Chart'  },
      { href: '#analytics-chart-data', expectedText: '4529795.72',                    name: 'Raw Dataset'        },
      { href: '#field',                expectedText: 'Akron',                         name: 'Filterable Field'   },
    ];

    for (const ct of contentTests) {
      console.log(`Testing ${ct.name}...`);
      await page.click(`a[href="${ct.href}"]`);
      const sectionId = ct.href.replace('#', '');
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
      await page.waitForSelector(`text=${ct.expectedText}`, { timeout: 60000 });
      console.log(`PASS: ${ct.name} content loaded`);
    }

    // Legacy chart — verify SVG text content
    console.log('Testing Legacy Charts...');
    await page.click('a[href="#classic-chart"]');
    await expect(page.locator('#classic-chart')).toBeVisible();
    await page.waitForSelector('#classic-chart qlik-embed svg text', { timeout: 60000 });
    await page.waitForSelector('#classic-chart qlik-embed svg text:has-text("Bologna")', { timeout: 60000 });
    console.log('PASS: Legacy chart rendered with expected data');

    // Classic app — verify content inside the embedded iframe
    console.log('Testing Classic App (iframe)...');
    await page.click('a[href="#classic-app"]');
    await expect(page.locator('#classic-app')).toBeVisible();
    await page.waitForSelector('#classic-app iframe', { timeout: 60000 });
    const iframe = page.frameLocator('#classic-app iframe');
    await iframe.locator('text=Margin Amount Over Time').waitFor({ timeout: 60000 });
    console.log('PASS: Classic app iframe content loaded');
  });

  // ─── Graceful loading: embed element is always present while content loads ─

  test('should handle Qlik content loading gracefully', async ({ page }) => {
    await login(page);

    await page.click('a[href="#sheet-nav"]');
    await expect(page.locator('#sheet-nav')).toBeVisible();

    // The embed element must be present immediately (before content renders)
    const qlikEmbed = page.locator('qlik-embed[ui="analytics/sheet"]');
    await expect(qlikEmbed).toBeAttached();
    console.log('PASS: Qlik embed element is present');

    try {
      await page.waitForSelector('text=Margin Amount Over Time', { timeout: 60000 });
      console.log('PASS: Content loaded within expected timeframe');
    } catch {
      console.log('INFO: Content still loading after 60 s — embed element is present');
      await page.screenshot({ path: 'test-results/content-loading-debug.png' });
    }
  });
});
