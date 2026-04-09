import { test, expect } from '@playwright/test';

/**
 * Backend Health & Diagnostics
 *
 * These tests verify the Node.js server and its connections to Qlik Cloud
 * **before** any browser-based embed tests run. When the Qlik content tests
 * fail with 500s, this suite pinpoints which layer is broken:
 *
 *   1. Express server reachable
 *   2. Environment / config wired correctly
 *   3. Backend OAuth token (M2M client-credentials)
 *   4. Frontend OAuth token (impersonation)
 *   5. QIX engine — app-sheets
 *   6. QIX engine — hypercube
 *
 * Only runs in a single browser (chromium) since it tests HTTP APIs, not rendering.
 */

// Only run in chromium — these are pure API tests, no browser rendering involved.
// (file-level skip is not reliably supported; the beforeEach below handles it.)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** POST /login with a test email and return the session cookie jar. */
async function getAuthenticatedContext(request) {
  // 1. Grab a CSRF token (sets the _csrf cookie too)
  const csrfRes = await request.get('/csrf-token');
  expect(csrfRes.ok(), `GET /csrf-token failed: ${csrfRes.status()}`).toBeTruthy();
  const { csrfToken } = await csrfRes.json();
  expect(csrfToken, 'CSRF token should be a non-empty string').toBeTruthy();

  // 2. POST /login — the server sets session.email and redirects to /
  //    which in turn provisions the Qlik user and sets session.userId.
  //    Retry once if the Qlik user-provisioning call is transiently slow.
  let loginRes;
  for (let attempt = 1; attempt <= 2; attempt++) {
    loginRes = await request.post('/login', {
      form: { email: 'backend-health-test@test.com', _csrf: csrfToken },
      maxRedirects: 5,           // follow the redirect chain → / → home.html
    });
    if (loginRes.status() === 200) break;
    if (attempt < 2) {
      console.log(`Login attempt ${attempt} returned ${loginRes.status()}, retrying…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  // After redirects we should land on 200 (home.html) or get a clear error
  return { loginRes, csrfToken };
}

/** Fetch a fresh CSRF token (needed for POST endpoints after login). */
async function freshCsrf(request) {
  const res = await request.get('/csrf-token');
  const { csrfToken } = await res.json();
  return csrfToken;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Backend Health & Diagnostics', () => {
  // Use a single APIRequestContext that persists cookies across tests
  // so we only need to log in once.
  test.describe.configure({ mode: 'serial' });

  // Skip in non-chromium browsers — these are pure HTTP/API tests.
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'API-only tests — chromium only');
  });

  test('1 — Express server is reachable', async ({ request }) => {
    const res = await request.get('/login');
    expect(res.status(), 'GET /login should return 200').toBe(200);
    const body = await res.text();
    expect(body).toContain('loginButton');
    console.log('OK: Express server is up and serving /login');
  });

  test('2 — CSRF token endpoint works', async ({ request }) => {
    const res = await request.get('/csrf-token');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.csrfToken).toBeTruthy();
    console.log('OK: /csrf-token returns a valid token');
  });

  test('3 — Login + user provisioning succeeds (/)', async ({ request }) => {
    const { loginRes } = await getAuthenticatedContext(request);
    // After redirect chain, a 200 means the backend successfully:
    //   - accepted the email
    //   - obtained a backend M2M token
    //   - looked up / created the Qlik user
    //   - served home.html
    expect(
      loginRes.status(),
      `Login chain failed with ${loginRes.status()}. ` +
      'Likely cause: backend M2M OAuth credentials are invalid or the tenant is unreachable.\n' +
      `Response: ${(await loginRes.text()).slice(0, 500)}`
    ).toBe(200);
    console.log('OK: Login + Qlik user provisioning succeeded (backend M2M token works)');
  });

  test('4 — Frontend access token (/access-token)', async ({ request }) => {
    // Ensure we have an authenticated session
    await getAuthenticatedContext(request);
    const csrf = await freshCsrf(request);

    const res = await request.post('/access-token', {
      headers: { 'CSRF-Token': csrf },
    });

    if (res.status() === 401) {
      const body = await res.text();
      const msg = 'FAIL: POST /access-token returned 401.\n' +
        'The frontend (impersonation) OAuth client cannot mint a token.\n' +
        'Check OAUTH_FRONTEND_CLIENT_ID / OAUTH_FRONTEND_CLIENT_SECRET and\n' +
        'ensure the client has the "impersonation" grant type enabled on the tenant.\n' +
        `Response: ${body}`;
      console.log(msg);
      test.fail(true, msg);
    }

    expect(res.status(), `POST /access-token returned ${res.status()}`).toBe(200);
    const token = await res.text();
    expect(token.length, 'Access token should be a non-trivial string').toBeGreaterThan(20);

    // Quick JWT structure check (header.payload.signature)
    const jwtParts = token.split('.');
    expect(jwtParts.length, 'Token should be a 3-part JWT').toBe(3);

    // Decode the payload to surface useful diagnostics
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());
      console.log('OK: Frontend access token minted successfully');
      console.log(`   sub (user):  ${payload.sub ?? 'N/A'}`);
      console.log(`   subType:     ${payload.subType ?? 'N/A'}`);
      console.log(`   tenantId:    ${payload.tenantId ?? payload.aud ?? 'N/A'}`);
      console.log(`   scope:       ${payload.scope ?? 'N/A'}`);

      const exp = payload.exp ? new Date(payload.exp * 1000) : null;
      if (exp) {
        const remainingMs = exp.getTime() - Date.now();
        console.log(`   expires:     ${exp.toISOString()} (${Math.round(remainingMs / 1000)}s from now)`);
        expect(remainingMs, 'Token should not already be expired').toBeGreaterThan(0);
      }
    } catch {
      console.log('OK: Token received (could not decode payload for diagnostics)');
    }
  });

  test('5 — Config endpoint returns expected params (/config)', async ({ request }) => {
    await getAuthenticatedContext(request);
    const csrf = await freshCsrf(request);

    const res = await request.post('/config', {
      headers: { 'CSRF-Token': csrf },
    });
    expect(res.status()).toBe(200);
    const config = await res.json();

    const requiredKeys = ['tenantUri', 'oAuthFrontEndClientId', 'appId', 'sheetId', 'objectId', 'fieldId'];
    const missing = requiredKeys.filter(k => !config[k]);
    expect(
      missing,
      `Missing config keys: ${missing.join(', ')}. ` +
      'These must be set in .env for embeds to work.'
    ).toHaveLength(0);

    console.log('OK: /config returns all required parameters');
    console.log(`   tenantUri:    ${config.tenantUri}`);
    console.log(`   appId:        ${config.appId}`);
    console.log(`   sheetId:      ${config.sheetId}`);
    console.log(`   objectId:     ${config.objectId}`);
    console.log(`   fieldId:      ${config.fieldId}`);
    console.log(`   assistantId:  ${config.assistantId || '(not set)'}`);
    console.log(`   masterDim:    ${config.masterDimension || '(not set)'}`);
    console.log(`   masterMeasure:${config.masterMeasure || '(not set)'}`);
  });

  test('6 — QIX engine: sheet list (/app-sheets)', async ({ request }) => {
    await getAuthenticatedContext(request);

    const res = await request.get('/app-sheets');

    if (res.status() !== 200) {
      let body;
      try { body = await res.json(); } catch { body = { raw: await res.text().catch(() => '(empty)') }; }
      const pretty = JSON.stringify(body, null, 2);

      console.log(`\nFAIL: GET /app-sheets returned ${res.status()}`);
      console.log(`Error:        ${body.error ?? 'N/A'}`);
      console.log(`Message:      ${body.message ?? 'N/A'}`);
      console.log(`Code:         ${body.code ?? 'N/A'}`);
      console.log(`Enigma error: ${body.enigmaError ?? false}`);
      if (body.stack) console.log(`Stack:\n${body.stack}`);
      console.log(`Full response body:\n${pretty}\n`);

      expect.soft(res.status(), `GET /app-sheets failed — see error details above`).toBe(200);
      return;
    }

    expect(res.status(), `/app-sheets returned ${res.status()}`).toBe(200);
    const sheets = await res.json();
    expect(Array.isArray(sheets), 'Response should be an array of sheets').toBeTruthy();
    expect(sheets.length, 'App should have at least one sheet').toBeGreaterThan(0);

    console.log(`OK: /app-sheets returned ${sheets.length} sheet(s):`);
    for (const s of sheets) {
      console.log(`   • "${s.qMeta?.title}" (${s.qMeta?.id})`);
    }
  });

  test('7 — QIX engine: hypercube data (/hypercube)', async ({ request }) => {
    await getAuthenticatedContext(request);

    const res = await request.get('/hypercube');

    if (res.status() !== 200) {
      let body;
      try { body = await res.json(); } catch { body = { raw: await res.text().catch(() => '(empty)') }; }
      const pretty = JSON.stringify(body, null, 2);

      console.log(`\nFAIL: GET /hypercube returned ${res.status()}`);
      console.log(`Error:        ${body.error ?? 'N/A'}`);
      console.log(`Message:      ${body.message ?? 'N/A'}`);
      console.log(`Code:         ${body.code ?? 'N/A'}`);
      console.log(`Enigma error: ${body.enigmaError ?? false}`);
      if (body.stack) console.log(`Stack:\n${body.stack}`);
      console.log(`Full response body:\n${pretty}\n`);

      expect.soft(res.status(), `GET /hypercube failed — see error details above`).toBe(200);
      return;
    }

    expect(res.status(), `/hypercube returned ${res.status()}`).toBe(200);
    const data = await res.json();
    expect(data.returnedDimension, 'Response should have returnedDimension array').toBeDefined();
    expect(data.returnedMeasure, 'Response should have returnedMeasure array').toBeDefined();
    expect(data.returnedDimension.length, 'Should have at least one data row').toBeGreaterThan(0);

    console.log(`OK: /hypercube returned ${data.returnedDimension.length} row(s)`);
    console.log(`   First dimension: "${data.returnedDimension[0]}"`);
    console.log(`   First measure:   "${data.returnedMeasure[0]}"`);
  });

  test('8 — QIX engine: user attributes (/user-attributes)', async ({ request }) => {
    await getAuthenticatedContext(request);

    const res = await request.get('/user-attributes');

    if (res.status() !== 200) {
      let body;
      try { body = await res.json(); } catch { body = { raw: await res.text().catch(() => '(empty)') }; }
      const pretty = JSON.stringify(body, null, 2);

      console.log(`\nFAIL: GET /user-attributes returned ${res.status()}`);
      console.log(`Error:        ${body.error ?? 'N/A'}`);
      console.log(`Message:      ${body.message ?? 'N/A'}`);
      console.log(`Code:         ${body.code ?? 'N/A'}`);
      console.log(`Enigma error: ${body.enigmaError ?? false}`);
      if (body.stack) console.log(`Stack:\n${body.stack}`);
      console.log(`Full response body:\n${pretty}\n`);

      expect.soft(res.status(), `GET /user-attributes failed — see error details above`).toBe(200);
      return;
    }

    expect(res.status(), `/user-attributes returned ${res.status()}`).toBe(200);
    const data = await res.json();
    expect(data.sessionUserId, 'Response should have sessionUserId').toBeTruthy();
    expect(data.qlikUserId, 'Response should have qlikUserId').toBeTruthy();

    console.log(`OK: /user-attributes returned valid user info`);
    console.log(`   sessionUserId: ${data.sessionUserId}`);
    console.log(`   qlikUserId:    ${data.qlikUserId}`);
  });
});

// ── Unauthenticated 401 contract tests ──────────────────────────────────────
// Verify that protected API endpoints return 401 JSON (not a 302 redirect)
// when called without a session.

test.describe('Unauthenticated API — 401 contract', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'API-only tests — chromium only');
  });

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
