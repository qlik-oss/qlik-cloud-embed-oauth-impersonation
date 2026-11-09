// Shared fixtures for the hermetic server tests (node:test + supertest).
// Nothing here talks to Qlik Cloud: `createQlikStub()` stands in for `@qlik/api`.
import { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';

export const TEST_ENV = Object.freeze({
  NODE_ENV: 'development',
  SESSION_SECRET: 'test-session-secret',
  TENANT_URI: 'tenant.example.qlikcloud.com',
  OAUTH_BACKEND_CLIENT_ID: 'backend-client-id',
  OAUTH_BACKEND_CLIENT_SECRET: 'backend-client-secret-value',
  OAUTH_FRONTEND_CLIENT_ID: 'frontend-client-id',
  OAUTH_FRONTEND_CLIENT_SECRET: 'frontend-client-secret-value',
  APP_ID: 'app-123',
  SHEET_ID: 'sheet-1',
  OBJECT_ID: 'object-1',
  FIELD_ID: 'City',
  ASSISTANT_ID: 'assistant-1',
  AGENTIC_ASSISTANT_ID: 'agentic-1',
  HYPERCUBE_DIMENSION: 'Product Type',
  HYPERCUBE_MEASURE: '=Sum([Sales Amount])',
  MASTER_DIMENSION: 'Product Type',
  MASTER_MEASURE: 'Sales $',
  USER_PREFIX: 'oauth_gen_',
});

/** Build `n` hypercube rows: [{qText: 'Dim i'}, {qText: 'i'}]. */
export function makeRows(n) {
  return Array.from({ length: n }, (_, i) => [{ qText: `Dim ${i}` }, { qText: String(i) }]);
}

/**
 * Fake QIX session object that honours qInitialDataFetch and qTop/qHeight paging
 * the way the engine does.
 */
function makeHypercubeModel(rows, properties) {
  const initialHeight = properties.qHyperCubeDef.qInitialDataFetch[0].qHeight;
  return {
    id: 'session-object-1',
    properties,
    getLayout: mock.fn(async () => ({
      qHyperCube: {
        qSize: { qcx: 2, qcy: rows.length },
        qDataPages: [{ qMatrix: rows.slice(0, initialHeight) }],
      },
    })),
    getHyperCubeData: mock.fn(async (_path, [page]) => [
      { qMatrix: rows.slice(page.qTop, page.qTop + page.qHeight) },
    ]),
  };
}

/**
 * Stand-in for the `@qlik/api` modules the app uses. Every function is a `mock.fn`
 * so tests can assert on arguments; pass `overrides` to change behaviour.
 */
export function createQlikStub({
  existingUsers = [{ id: 'existing-user-id' }],
  hypercubeRows = makeRows(3),
  sheets = [
    { qMeta: { title: 'Sheet B', id: 'sheet-2' }, qData: { rank: 1 } },
    { qMeta: { title: 'Sheet A', id: 'sheet-1' }, qData: { rank: 0 } },
  ],
  osUser = 'UserDirectory=; UserId=oauth_gen_someone@test.com',
} = {}) {
  const stub = { models: [] };

  const doc = {
    getSheetList: mock.fn(async () => sheets),
    evaluateEx: mock.fn(async () => ({ qText: osUser })),
    createSessionObject: mock.fn(async (properties) => {
      const model = makeHypercubeModel(hypercubeRows, properties);
      stub.models.push(model);
      return model;
    }),
    destroySessionObject: mock.fn(async () => {}),
  };

  stub.doc = doc;
  stub.auth = {
    setDefaultHostConfig: mock.fn(),
    getAccessToken: mock.fn(async () => 'header.payload.signature'),
  };
  stub.users = {
    getUsers: mock.fn(async () => ({ data: { data: existingUsers } })),
    createUser: mock.fn(async () => ({ data: { id: 'created-user-id' } })),
  };
  stub.qix = {
    openAppSession: mock.fn(() => ({ getDoc: async () => doc })),
  };
  return stub;
}

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
