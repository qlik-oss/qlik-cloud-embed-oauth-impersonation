// Shared fixtures for the hermetic server tests (node:test + supertest).
// Nothing here talks to Qlik Cloud: `createQlikStub()` stands in for `@qlik/api`.
import { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { TEST_ENV, createQlikStub } from '../support/qlik-stub.js';

export { TEST_ENV, createQlikStub, makeRows } from '../support/qlik-stub.js';

/** Create an app wired to a stub; returns `{ app, qlik }`. */
export function buildApp({ env = {}, qlik = createQlikStub(), rateLimits } = {}) {
  const app = createApp({ qlik, env: { ...TEST_ENV, ...env }, rateLimits });
  return { app, qlik };
}

/** Fetch a CSRF token with the given agent (sets the `_csrf` secret cookie on it). */
export async function getCsrf(agent) {
  const res = await agent.get('/csrf-token').expect(200);
  assert.ok(res.body.csrfToken, 'expected a CSRF token');
  return res.body.csrfToken;
}

/**
 * Log an agent in the way the browser does: POST /login, then GET / (user provisioning).
 * Returns the agent plus the responses for further assertions.
 */
export async function login(app, email = 'someone@test.com', agent = request.agent(app)) {
  const csrfToken = await getCsrf(agent);
  const loginRes = await agent
    .post('/login')
    .type('form')
    .send({ email, _csrf: csrfToken })
    .expect(302)
    .expect('Location', '/');
  const homeRes = await agent.get('/');
  return { agent, csrfToken, loginRes, homeRes };
}

/** Return the value of a named cookie from a response's Set-Cookie headers. */
export function getSetCookie(res, name) {
  const header = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
  return header ?? null;
}

/** The app logs every request; keep test output readable. */
export function useQuietConsole() {
  beforeEach(() => {
    for (const method of ['log', 'warn', 'error']) mock.method(console, method, () => {});
  });
  afterEach(() => mock.restoreAll());
}
