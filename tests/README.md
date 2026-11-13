# Tests for Qlik Cloud Embed OAuth Impersonation

Three suites live here:

- **`unit/`** — hermetic server tests (`node:test` + supertest). `@qlik/api` is replaced by a stub
  (`support/qlik-stub.js` → `createQlikStub()`), so they need no `.env` or tenant. Run with `npm run test:unit`
  or `npm run test:coverage`.
- **`browser/`** — hermetic Playwright tests for the pages and `js/script.js`. `browser/stub-server.js`
  runs the real app with the same Qlik stub, the CDN scripts are blocked, and error cases are produced
  with `page.route()`. Run with `npm run test:browser` (config: `playwright.browser.config.js`).
- **`*.spec.js`** — Playwright end-to-end tests that run against a **live** Qlik Cloud tenant.
  They require valid `.env` credentials (or CI secrets) and a running server. Run with `npm run test:e2e`.

`npm test` runs all three in order (unit, browser, then end-to-end). Without a configured `.env`, the first
two pass and the end-to-end step fails; use `npm run test:unit` and `npm run test:browser` on their own if you
don't have a tenant.

`support/qlik-stub.js` holds the shared `@qlik/api` stub and test env.

## Unit test files

| File | What it covers |
|------|---------------|
| `unit/utils.test.js` | `normalizeTenantUri`, `escapeODataString`, required-env validation. |
| `unit/startup.test.js` | `server.js` exits with code 1 and lists missing env vars; starts with the real `@qlik/api` and serves `/login`; logs a normalized `TENANT_URI`; exits with a clear message when the port is in use. |
| `unit/auth.test.js` | Login (CSRF, missing email, session regeneration), cookie flags, user lookup/creation on `GET /`, provisioning errors, logout. |
| `unit/api.test.js` | `/access-token` (scopes, 502 on mint failure), `/config` (contents, no secrets), QIX routes, hypercube paging, error bodies (stack hidden in production). |
| `unit/security.test.js` | 401 contract, static file exposure and path traversal, rate limits. |

## Browser test files

| File | What it covers |
|------|---------------|
| `browser/client.spec.js` | Login page (random email; CSRF token failure by HTTP status, network error or missing token shows a message and leaves the button usable), embeds created from `/config`, qlik-embed script attributes, "not configured" assistant messages, `/config` failure, sheet dropdown order and switching, chart type switching, raw data table and user badge, `/hypercube` error message, session-expiry redirect, and `getAccessToken` (502 stays on the page, 401 goes to `/login`). Also: sidebar navigation shows one section at a time, `/config` 401 on first load, logout, `/app-sheets` failure doesn't block the data table, `/user-attributes` failure message, hypercube values rendered as text (no HTML injection), and the AI assistant loading placeholder → reveal. |

## End-to-end test files

For local runs over **http://localhost**, keep `NODE_ENV=development` in `.env` (see the project `template.env` and main README) so session cookies work; otherwise login and CSRF checks can fail.

| File | What it covers |
|------|---------------|
| `backend-health.spec.js` | Server reachability, CSRF, login/user provisioning, impersonation token (`subType: user`), `/config` contents with no secrets, QIX engine endpoints (`/app-sheets`, `/hypercube`, `/user-attributes` showing the impersonated user), CSRF enforcement, logout, and the 401 contract. Logs in once and runs in order. Chromium only (pure HTTP). |
| `core-functionality.spec.js` | Authentication flow (redirect → login → logout), sidebar navigation to every section, and the data panel refresh workflow (loading state, timestamp, session badge). |
| `fixtures.js` | Shared `test` that logs in once per worker and reuses the session, to stay under the login rate limit. |
| `qlik-content-verification.spec.js` | Embed element presence for all UI types, sheet navigation, on-the-fly chart type switching, and content display with expected data values. If `/app-sheets` fails, the sheet tests skip locally but **fail on CI**. |

## Running

```bash
# All end-to-end tests (starts server automatically via playwright.config.js)
npx playwright test

# Single file
npx playwright test tests/backend-health.spec.js

# Single browser
npx playwright test --project=chromium

# Interactive UI mode
npx playwright test --ui

# Headed (watch the browser)
npx playwright test --headed

# View last report
npx playwright show-report
```

## CI

The `playwright.config.js` is set up for CI:

- `webServer.command` starts the app with `npm start`
- `reuseExistingServer` is `false` on CI so a fresh instance is used
- Retries are enabled (`2`) on CI
- Workers are serialised to `1` on CI to avoid port conflicts

The workflow runs the `hermetic` job (unit + browser tests, no secrets) alongside the end-to-end `test` job.

Provide the same environment variables you use locally as GitHub Actions secrets.
