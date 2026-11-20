// Runs the real Express app (src/app.js) with a stubbed @qlik/api, for the hermetic
// browser tests in this folder. No .env or Qlik Cloud tenant is needed.
// Started by playwright.browser.config.js; run by hand with `node tests/browser/stub-server.js`.
import { createApp } from '../../src/app.js';
import { TEST_ENV, createQlikStub, makeRows } from '../support/qlik-stub.js';

const PORT = Number(process.env.STUB_PORT || 3100);

const qlik = createQlikStub({
  hypercubeRows: makeRows(12),
  sheets: [
    { qMeta: { title: 'Second sheet', id: 'sheet-2' }, qData: { rank: 1 } },
    { qMeta: { title: 'First sheet', id: 'sheet-1' }, qData: { rank: 0 } },
    { qMeta: { title: 'Third sheet', id: 'sheet-3' }, qData: { rank: 2 } },
  ],
});

const app = createApp({
  qlik,
  env: { ...TEST_ENV, SHEET_ID: 'sheet-2' },
  // Local runs reuse this server across test runs; don't let the login limiter trip
  rateLimits: { login: 100000, file: 100000, token: 100000 },
});

app.listen(PORT, () => {
  console.log(`Stub server running at http://localhost:${PORT}`);
});
