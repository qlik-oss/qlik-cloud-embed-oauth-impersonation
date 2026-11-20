import { test, expect } from '@playwright/test';

/**
 * Backend Health & Diagnostics
 *
 * These tests verify the Node.js server and its connections to Qlik Cloud
 * **before** any browser-based embed tests run. When the Qlik content tests
 * fail with 500s, this suite pinpoints which layer is broken:
 *
 *   1. Express server reachable
 *   2. CSRF token endpoint
 *   3. Login + user provisioning (backend M2M client)
 *   4. Frontend OAuth token (impersonation)
 *   5. Config sent to the browser (and no secrets in it)
 *   6–8. QIX engine — app-sheets, hypercube, user attributes (impersonated identity)
 *   9. CSRF enforcement on authenticated POSTs
 *  10. Logout ends the session
 *
 * Pure HTTP — runs in the chromium project only (see playwright.config.js).
 */

const TEST_EMAIL = 'backend-health-test@test.com';
const USER_PREFIX = process.env.USER_PREFIX ?? 'oauth_gen_';

/** Print a failed QIX response in detail, then record a soft failure. */
async function reportQixFailure(res, path) {
  let body;
  try { body = await res.json(); } catch { body = { raw: await res.text().catch(() => '(empty)') }; }

  console.log(`\nFAIL: GET ${path} returned ${res.status()}`);
  console.log(`Error:        ${body.error ?? 'N/A'}`);
  console.log(`Message:      ${body.message ?? 'N/A'}`);
  console.log(`Code:         ${body.code ?? 'N/A'}`);
  console.log(`Enigma error: ${body.enigmaError ?? false}`);
  if (body.stack) console.log(`Stack:\n${body.stack}`);
  console.log(`Full response body:\n${JSON.stringify(body, null, 2)}\n`);

  expect.soft(res.status(), `GET ${path} failed — see error details above`).toBe(200);
}

test.describe('Backend Health & Diagnostics', () => {
  // Serial: the numbered checks share one logged-in API context and stop at the
  // first broken layer. Logging in once also keeps the suite well under the
  // server's login rate limit (40 per 15 minutes per IP).
  test.describe.configure({ mode: 'serial' });

  /** @type {import('@playwright/test').APIRequestContext} */
  let api;

  /** Fresh CSRF token for the shared context (needed for POST endpoints). */
  async function csrf() {
    const res = await api.get('/csrf-token');
    expect(res.ok(), `GET /csrf-token failed: ${res.status()}`).toBeTruthy();
    return (await res.json()).csrfToken;
  }

  test.beforeAll(async ({ playwright, baseURL }) => {
    api = await playwright.request.newContext({ baseURL });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test('1 — Express server is reachable', async () => {
    const res = await api.get('/login');
    expect(res.status(), 'GET /login should return 200').toBe(200);
    expect(await res.text()).toContain('loginButton');
    console.log('OK: Express server is up and serving /login');
  });

  test('2 — CSRF token endpoint works', async () => {
    expect(await csrf(), 'CSRF token should be a non-empty string').toBeTruthy();
    console.log('OK: /csrf-token returns a valid token');
  });

  test('3 — Login + user provisioning succeeds (/)', async () => {
    // POST /login sets session.email and redirects to /, which provisions the
    // Qlik user and sets session.userId. Retry once if provisioning is transiently slow.
    let loginRes;
    for (let attempt = 1; attempt <= 2; attempt++) {
      loginRes = await api.post('/login', {
        form: { email: TEST_EMAIL, _csrf: await csrf() },
        maxRedirects: 5, // follow the redirect chain → GET / (serves home.html)
      });
      if (loginRes.status() === 200) break;
      if (attempt < 2) {
        console.log(`Login attempt ${attempt} returned ${loginRes.status()}, retrying…`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // A 200 here means the backend accepted the email, obtained a backend M2M
    // token, looked up / created the Qlik user and served home.html.
    expect(
      loginRes.status(),
      `Login chain failed with ${loginRes.status()}. ` +
      'Likely cause: backend M2M OAuth credentials are invalid or the tenant is unreachable.\n' +
      `Response: ${(await loginRes.text()).slice(0, 500)}`
    ).toBe(200);
    console.log('OK: Login + Qlik user provisioning succeeded (backend M2M token works)');
  });

  test('4 — Frontend access token (/access-token)', async () => {
    const res = await api.post('/access-token', { headers: { 'CSRF-Token': await csrf() } });

    // 502 = the server could not mint a token (401 would mean the session was lost)
    const hint = res.status() === 502
      ? 'The frontend (impersonation) OAuth client cannot mint a token.\n' +
        'Check OAUTH_FRONTEND_CLIENT_ID / OAUTH_FRONTEND_CLIENT_SECRET and\n' +
        'ensure the client has the "impersonation" grant type enabled on the tenant.\n'
      : '';
    expect(
      res.status(),
      `POST /access-token returned ${res.status()}.\n${hint}Response: ${res.status() === 200 ? '' : await res.text()}`
    ).toBe(200);

    const token = await res.text();
    const jwtParts = token.split('.');
    expect(jwtParts.length, 'Token should be a 3-part JWT').toBe(3);

    const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());
    // Impersonation tokens are issued for a user; a token for the OAuth client itself is not
    expect(payload.subType, 'Token should be issued for a user (impersonation), not the client').toBe('user');
    expect(payload.exp, 'Token should have an expiry').toBeTruthy();
    const remainingMs = payload.exp * 1000 - Date.now();
    expect(remainingMs, 'Token should not already be expired').toBeGreaterThan(0);

    console.log('OK: Frontend access token minted successfully');
    console.log(`   subType:     ${payload.subType}`);
    console.log(`   expires:     ${new Date(payload.exp * 1000).toISOString()} (${Math.round(remainingMs / 1000)}s from now)`);
  });

  test('5 — Config endpoint returns expected params and no secrets (/config)', async () => {
    const res = await api.post('/config', { headers: { 'CSRF-Token': await csrf() } });
    expect(res.status()).toBe(200);
    const text = await res.text();
    const config = JSON.parse(text);

    const requiredKeys = ['tenantUri', 'oAuthFrontEndClientId', 'appId', 'sheetId', 'objectId', 'fieldId'];
    const missing = requiredKeys.filter(k => !config[k]);
    expect(
      missing,
      `Missing config keys: ${missing.join(', ')}. These must be set in .env for embeds to work.`
    ).toHaveLength(0);
    expect(config.userEmail, 'Config should include the logged-in email').toBe(TEST_EMAIL);

    // The browser must never receive OAuth client secrets or the session secret
    for (const name of ['OAUTH_BACKEND_CLIENT_SECRET', 'OAUTH_FRONTEND_CLIENT_SECRET', 'SESSION_SECRET']) {
      const value = process.env[name];
      if (value) expect(text.includes(value), `/config response must not contain ${name}`).toBe(false);
    }

    console.log('OK: /config returns all required parameters and no secrets');
    console.log(`   tenantUri:    ${config.tenantUri}`);
    console.log(`   appId:        ${config.appId}`);
    console.log(`   assistantId:  ${config.assistantId || '(not set)'}`);
  });

  test('6 — QIX engine: sheet list (/app-sheets)', async () => {
    const res = await api.get('/app-sheets');
    if (res.status() !== 200) return reportQixFailure(res, '/app-sheets');

    const sheets = await res.json();
    expect(Array.isArray(sheets), 'Response should be an array of sheets').toBeTruthy();
    expect(sheets.length, 'App should have at least one sheet').toBeGreaterThan(0);

    console.log(`OK: /app-sheets returned ${sheets.length} sheet(s):`);
    for (const s of sheets) {
      console.log(`   • "${s.qMeta?.title}" (${s.qMeta?.id})`);
    }
  });

  test('7 — QIX engine: hypercube data (/hypercube)', async () => {
    const res = await api.get('/hypercube');
    if (res.status() !== 200) return reportQixFailure(res, '/hypercube');

    const data = await res.json();
    expect(data.returnedDimension.length, 'Should have at least one data row').toBeGreaterThan(0);
    expect(data.returnedMeasure.length, 'Dimension and measure arrays should match').toBe(data.returnedDimension.length);

    console.log(`OK: /hypercube returned ${data.returnedDimension.length} row(s)`);
    console.log(`   First dimension: "${data.returnedDimension[0]}"`);
    console.log(`   First measure:   "${data.returnedMeasure[0]}"`);
  });

  test('8 — QIX engine: engine session runs as the impersonated user (/user-attributes)', async () => {
    const res = await api.get('/user-attributes');
    if (res.status() !== 200) return reportQixFailure(res, '/user-attributes');

    const data = await res.json();
    expect(data.sessionUserId, 'Response should have sessionUserId').toBeTruthy();
    // OSUser() reports the identity the engine sees: it must be the prefixed login email,
    // proving the frontend client really impersonated this user.
    expect(data.qlikUserId, 'Engine should see the impersonated user').toContain(`UserId=${USER_PREFIX}${TEST_EMAIL}`);

    console.log('OK: engine session is the impersonated user');
    console.log(`   sessionUserId: ${data.sessionUserId}`);
    console.log(`   qlikUserId:    ${data.qlikUserId}`);
  });

  test('9 — Authenticated POSTs require a CSRF token', async () => {
    for (const path of ['/config', '/access-token']) {
      const res = await api.post(path);
      expect(res.status(), `POST ${path} without CSRF-Token should be rejected`).toBe(403);
    }
    console.log('OK: CSRF token is enforced on /config and /access-token');
  });

  test('10 — Logout ends the session', async () => {
    const res = await api.get('/logout', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/login');

    const after = await api.get('/user-attributes');
    expect(after.status(), 'Session should be gone after logout').toBe(401);
    console.log('OK: logout destroys the session');
  });
});

// ── Unauthenticated 401 contract tests ──────────────────────────────────────
// Verify that protected API endpoints return 401 JSON (not a 302 redirect)
// when called without a session.

test.describe('Unauthenticated API — 401 contract', () => {
  test.describe.configure({ mode: 'parallel' });

  const protectedEndpoints = [
    { method: 'GET',  path: '/app-sheets' },
    { method: 'GET',  path: '/hypercube' },
    { method: 'GET',  path: '/user-attributes' },
    { method: 'POST', path: '/access-token' },
    { method: 'POST', path: '/config' },
  ];

  for (const { method, path } of protectedEndpoints) {
    test(`${method} ${path} returns 401 JSON without session`, async ({ request }) => {
      const res = method === 'GET'
        ? await request.get(path, { maxRedirects: 0 })
        : await request.post(path, { maxRedirects: 0 });

      expect(res.status(), `${method} ${path} should return 401, got ${res.status()}`).toBe(401);

      const body = await res.json();
      expect(body.error, 'Response body should include an error field').toBe('session_expired');
    });
  }
});
