# Playwright Tests for Qlik Cloud Embed OAuth Impersonation

End-to-end tests that run against a **live** Qlik Cloud tenant.
They require valid `.env` credentials (or CI secrets) and a running server.

For local runs over **http://localhost**, keep `NODE_ENV=development` in `.env` (see the project `template.env` and main README) so session cookies work; otherwise login and CSRF checks can fail.

## Test Files

| File | What it covers |
|------|---------------|
| `backend-health.spec.js` | Server reachability, CSRF, login/user provisioning, OAuth tokens, QIX engine endpoints (`/app-sheets`, `/hypercube`, `/user-attributes`), and 401 contract for unauthenticated requests. Runs in Chromium only (pure HTTP). |
| `core-functionality.spec.js` | Authentication flow (redirect → login → logout), sidebar navigation to every section, and the data panel refresh workflow (loading state, timestamp, session badge). |
| `qlik-content-verification.spec.js` | Embed element presence for all UI types, sheet navigation, on-the-fly chart type switching, content display with expected data values, and graceful loading behaviour. |
| `test-setup.js` | Shared setup utilities (server-readiness check). |

## Running

```bash
# All tests (starts server automatically via playwright.config.js)
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

Provide the same environment variables you use locally as GitHub Actions secrets.
