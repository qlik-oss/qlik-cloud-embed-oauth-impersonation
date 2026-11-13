# Tests for Qlik Cloud Embed OAuth Impersonation

Two suites live here:

- **`unit/`** — hermetic server tests (`node:test` + supertest). `@qlik/api` is replaced by a stub
  (`unit/helpers.js` → `createQlikStub()`), so they need no `.env` or tenant. Run with `npm run test:unit`
  or `npm run test:coverage`.
- **`*.spec.js`** — Playwright end-to-end tests that run against a **live** Qlik Cloud tenant.
  They require valid `.env` credentials (or CI secrets) and a running server. Run with `npm run test:e2e`.

## Unit test files

| File | What it covers |
|------|---------------|
| `unit/utils.test.js` | `normalizeTenantUri`, `escapeODataString`, required-env validation. |
| `unit/startup.test.js` | `server.js` exits with code 1 and lists missing env vars. |
| `unit/auth.test.js` | Login (CSRF, missing email, session regeneration), cookie flags, user lookup/creation on `GET /`, provisioning errors, logout. |
| `unit/api.test.js` | `/access-token` (scopes, 502 on mint failure), `/config` (contents, no secrets), QIX routes, hypercube paging, error bodies (stack hidden in production). |
| `unit/security.test.js` | 401 contract, static file exposure and path traversal, rate limits. |

## End-to-end test files

For local runs over **http://localhost**, keep `NODE_ENV=development` in `.env` (see the project `template.env` and main README) so session cookies work; otherwise login and CSRF checks can fail.

| File | What it covers |
|------|---------------|
| `backend-health.spec.js` | Server reachability, CSRF, login/user provisioning, OAuth tokens, QIX engine endpoints (`/app-sheets`, `/hypercube`, `/user-attributes`), and 401 contract for unauthenticated requests. Runs in Chromium only (pure HTTP). |
| `core-functionality.spec.js` | Authentication flow (redirect → login → logout), sidebar navigation to every section, and the data panel refresh workflow (loading state, timestamp, session badge). |
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

The workflow runs the `unit` job (no secrets) alongside the end-to-end `test` job.

Provide the same environment variables you use locally as GitHub Actions secrets.
