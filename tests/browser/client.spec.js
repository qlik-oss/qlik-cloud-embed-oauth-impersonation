import { test, expect } from '@playwright/test';

/**
 * Browser-side behaviour of login.html, home.html and js/script.js, run against the
 * stub server (no Qlik tenant). Error cases are produced with page.route().
 */

test.beforeEach(async ({ page }) => {
  // Block the CDN scripts: qlik-embed needs a real tenant, and the tests don't need Bootstrap.
  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
});

async function login(page) {
  await page.goto('/login');
  await expect(page.locator('#loginButton')).toBeEnabled();
  await page.click('#loginButton');
  await expect(page).toHaveURL(/\/$/);
}

test.describe('login page', () => {
  test('pre-fills a random test email and enables the button once a CSRF token arrives', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#loginButton')).toBeEnabled();
    await expect(page.locator('#email')).toHaveValue(/^[a-z-]+-[a-z-]+-[a-z-]+@test\.com$/);
    await expect(page.locator('#csrfToken')).not.toHaveValue('');
    await expect(page.locator('#login-error')).toBeHidden();
  });

  test('shows an error but still enables the button when the CSRF token cannot be fetched', async ({ page }) => {
    await page.route('**/csrf-token', (route) => route.fulfill({ status: 500, body: 'nope' }));
    await page.goto('/login');
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toHaveText(
      'Could not get a security token (the server returned HTTP 500). Refresh the page to try again.'
    );
    await expect(page.locator('#loginButton')).toBeEnabled();
  });

  test('shows an error and still enables the button when /csrf-token is unreachable', async ({ page }) => {
    await page.route('**/csrf-token', (route) => route.abort('connectionrefused'));
    await page.goto('/login');
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toContainText(/^Could not get a security token \(.+\)\. Refresh the page to try again\.$/);
    await expect(page.locator('#loginButton')).toBeEnabled();
  });

  test('shows an error when /csrf-token responds without a token', async ({ page }) => {
    await page.route('**/csrf-token', (route) => route.fulfill({ json: {} }));
    await page.goto('/login');
    await expect(page.locator('#login-error')).toContainText('the server response did not include a token');
    await expect(page.locator('#loginButton')).toBeEnabled();
  });
});

test.describe('home page', () => {
  test('creates one <qlik-embed> per UI type from /config', async ({ page }) => {
    await login(page);
    for (const ui of [
      'classic/app', 'analytics/chart', 'ai/agentic-assistant', 'ai/assistant',
      'analytics/field', 'analytics/selections', 'analytics/sheet', 'classic/chart',
    ]) {
      await expect(page.locator(`qlik-embed[ui="${ui}"]`).first(), ui).toBeAttached();
    }
    await expect(page.locator('#visualization')).toHaveAttribute('dimensions', '["[Product Type]"]');
    await expect(page.locator('#visualization')).toHaveAttribute('measures', '["[Sales $]"]');
    await expect(page.locator('#user-email')).toHaveText(/@test\.com$/);
  });

  test('loads qlik-embed from the CDN with the tenant, client id and token callback', async ({ page }) => {
    await login(page);
    const script = page.locator('script[src*="@qlik/embed-web-components"]');
    await expect(script).toHaveAttribute('data-host', 'https://tenant.example.qlikcloud.com');
    await expect(script).toHaveAttribute('data-client-id', 'frontend-client-id');
    await expect(script).toHaveAttribute('data-get-access-token', 'getAccessToken');
  });

  test('shows "not configured" messages when no assistant IDs are set', async ({ page }) => {
    await page.route('**/config', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      delete config.assistantId;
      delete config.agenticAssistantId;
      await route.fulfill({ response, json: config });
    });
    await login(page);
    await expect(page.locator('#agentic-assistant')).toContainText('Set AGENTIC_ASSISTANT_ID');
    await expect(page.locator('#ai-assistant')).toContainText('Set ASSISTANT_ID');
    await expect(page.locator('qlik-embed[ui^="ai/"]')).toHaveCount(0);
  });

  test('shows an application error when /config fails', async ({ page }) => {
    await page.route('**/config', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await login(page);
    await expect(page.getByText('Application Error:')).toBeVisible();
    await expect(page.locator('qlik-embed')).toHaveCount(0);
  });

  test('sorts sheets by rank, preselects SHEET_ID and switches the sheet embed', async ({ page }) => {
    await login(page);
    await page.click('a[href="#sheet-nav"]');
    const dropdown = page.locator('#sheetdrop');
    await expect(dropdown.locator('option')).toHaveText(['First sheet', 'Second sheet', 'Third sheet']);
    await expect(dropdown).toHaveValue('sheet-2');

    await dropdown.selectOption('sheet-3');
    await expect(page.locator('#sheet-change')).toHaveAttribute('sheet-id', 'sheet-3');
  });

  test('changes the on-the-fly chart type', async ({ page }) => {
    await login(page);
    await page.click('a[href="#on-the-fly"]');
    await page.locator('#chartType').selectOption('piechart');
    await expect(page.locator('#visualization')).toHaveAttribute('type', 'piechart');
  });
});

test.describe('raw data panel', () => {
  test('renders every hypercube row and the impersonated user', async ({ page }) => {
    await login(page);
    await page.click('a[href="#analytics-chart-data"]');
    const rows = page.locator('#chart-data tbody tr');
    await expect(rows).toHaveCount(12);
    await expect(rows.first()).toHaveText('Dim 00');
    await expect(rows.last()).toHaveText('Dim 1111');
    await expect(page.locator('#data-session-user')).toContainText('UserId=oauth_gen_someone@test.com');
    await expect(page.locator('#data-session-user')).toContainText('(user ID: existing-user-id)');
    await expect(page.locator('#data-last-refreshed')).toContainText('Updated');
  });

  test('shows the server error message and re-enables refresh when /hypercube fails', async ({ page }) => {
    await login(page);
    await page.click('a[href="#analytics-chart-data"]');
    await expect(page.locator('#chart-data table')).toBeAttached();

    await page.route('**/hypercube', (route) => route.fulfill({
      status: 500,
      json: { error: 'Unable to retrieve hypercube data', message: 'engine said no' },
    }));
    await page.click('#refresh-data-btn');
    await expect(page.locator('#chart-data')).toHaveText('Failed to load data: engine said no');
    await expect(page.locator('#refresh-data-btn')).toBeEnabled();
    await expect(page.locator('#refresh-data-btn')).toContainText('Refresh data');
  });

  test('redirects to /login when the session has expired', async ({ page, context }) => {
    await login(page);
    await page.click('a[href="#analytics-chart-data"]');
    await expect(page.locator('#chart-data table')).toBeAttached();

    await context.clearCookies();
    await page.click('#refresh-data-btn');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('getAccessToken (the qlik-embed token callback)', () => {
  test('returns the token minted by the server', async ({ page }) => {
    await login(page);
    const token = await page.evaluate(() => window.getAccessToken());
    expect(token).toBe('header.payload.signature');
  });

  test('a token mint failure (502) rejects without sending the user to /login', async ({ page }) => {
    await login(page);
    await page.route('**/access-token', (route) => route.fulfill({
      status: 502,
      json: { error: 'authentication_error', message: 'Unable to mint access token' },
    }));
    const status = await page.evaluate(() => window.getAccessToken().then(() => 'resolved', (e) => e.status));
    expect(status).toBe(502);
    await expect(page).toHaveURL(/\/$/);
  });

  test('an expired session (401) sends the user to /login', async ({ page }) => {
    await login(page);
    await page.route('**/access-token', (route) => route.fulfill({ status: 401, json: { error: 'session_expired' } }));
    await page.evaluate(() => window.getAccessToken().catch(() => {}));
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('navigation and session', () => {
  test('each sidebar link shows only its own section', async ({ page }) => {
    await login(page);
    const sections = [
      'agentic-assistant', 'ai-assistant', 'sheet-nav', 'classic-app', 'analytics-chart',
      'on-the-fly', 'classic-chart', 'field', 'analytics-chart-data', 'home',
    ];
    for (const id of sections) {
      await page.locator(`#sidenavAccordion a.nav-link[href="#${id}"]`).first().click();
      const shown = await page.locator('.content-item').evaluateAll((items) =>
        items.filter((el) => el.style.display === 'block').map((el) => el.id));
      expect(shown, `after clicking #${id}`).toEqual([id]);
    }
  });

  test('redirects to /login when /config reports an expired session on first load', async ({ page }) => {
    await page.route('**/config', (route) => route.fulfill({ status: 401, json: { error: 'session_expired' } }));
    // Not login(): the redirect can win the race with its "/" assertion. Waiting for the
    // /config request proves login succeeded and the home page asked for its config.
    const configRequested = page.waitForRequest('**/config');
    await page.goto('/login');
    await expect(page.locator('#loginButton')).toBeEnabled();
    await page.click('#loginButton');
    await configRequested;
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the logout link ends the session', async ({ page }) => {
    await login(page);
    // Bootstrap is blocked, so the dropdown never opens; click the link element directly
    await page.locator('a[href="/logout"]').evaluate((a) => a.click());
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('partial failures', () => {
  test('a /app-sheets failure leaves the dropdown empty but still loads the data table', async ({ page }) => {
    await page.route('**/app-sheets', (route) => route.fulfill({ status: 500, json: { error: 'Unable to retrieve sheet definitions' } }));
    await login(page);
    await expect(page.locator('#chart-data tbody tr')).toHaveCount(12);
    await expect(page.locator('#sheetdrop option')).toHaveCount(0);
    await expect(page.getByText('Application Error:')).toHaveCount(0);
  });

  test('a /user-attributes failure shows the error in the data panel', async ({ page }) => {
    await page.route('**/user-attributes', (route) => route.fulfill({
      status: 500,
      json: { error: 'Unable to retrieve user attributes', message: 'no OSUser' },
    }));
    await login(page);
    await page.click('a[href="#analytics-chart-data"]');
    await expect(page.locator('#chart-data')).toHaveText('Failed to load data: no OSUser');
    await expect(page.locator('#refresh-data-btn')).toBeEnabled();
  });

  test('renders hypercube values as text, not HTML', async ({ page }) => {
    const payload = '<img src=x onerror="window.__xss=1">';
    await page.route('**/hypercube', (route) => route.fulfill({
      json: { returnedDimension: [payload], returnedMeasure: ['<b>1</b>'] },
    }));
    await login(page);
    await page.click('a[href="#analytics-chart-data"]');
    const cells = page.locator('#chart-data tbody td');
    await expect(cells).toHaveText([payload, '<b>1</b>']);
    await expect(page.locator('#chart-data img, #chart-data b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('AI assistant embeds', () => {
  test('show a loading placeholder, then reveal the embed after the timeout', async ({ page }) => {
    await page.clock.install();
    await login(page);
    for (const [ui, loadingId] of [['ai/assistant', '#ai-assistant-loading'], ['ai/agentic-assistant', '#agentic-assistant-loading']]) {
      await expect(page.locator(loadingId)).toBeAttached();
      await expect(page.locator(`qlik-embed[ui="${ui}"]`)).toHaveCSS('display', 'none');
    }

    // No real web component renders here, so the 8s fallback reveals the embeds
    await page.clock.runFor(8500);
    for (const [ui, loadingId] of [['ai/assistant', '#ai-assistant-loading'], ['ai/agentic-assistant', '#agentic-assistant-loading']]) {
      await expect(page.locator(loadingId)).toHaveCount(0);
      await expect(page.locator(`qlik-embed[ui="${ui}"]`)).toHaveAttribute('style', /display: block/);
    }
  });
});
