// Stand-in for `@qlik/api` shared by the unit tests (tests/unit) and the hermetic
// browser tests' stub server (tests/browser/stub-server.js). Nothing here talks to Qlik Cloud.
import { mock } from 'node:test';

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
