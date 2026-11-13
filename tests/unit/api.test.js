// Token, config and QIX-backed routes — with @qlik/api stubbed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { FRONTEND_USER_APP_SCOPES, HYPERCUBE_PAGE_HEIGHT } from '../../src/app.js';
import {
  TEST_ENV,
  buildApp,
  createQlikStub,
  getCsrf,
  login,
  makeRows,
  useQuietConsole,
} from './helpers.js';

useQuietConsole();

/** An Error shaped like the ones @qlik/api / enigma reject with. */
function qixError({ status, code = 'QIX_ERR', message = 'engine said no' } = {}) {
  return Object.assign(new Error(message), { status, code, enigmaError: true });
}

describe('POST /access-token', () => {
  it('mints a token for the session user with the frontend client and user scope', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    const csrfToken = await getCsrf(agent);

    const res = await agent.post('/access-token').set('CSRF-Token', csrfToken).expect(200);
    assert.equal(res.text, 'header.payload.signature');

    const [{ hostConfig }] = qlik.auth.getAccessToken.mock.calls[0].arguments;
    assert.equal(hostConfig.userId, 'existing-user-id');
    assert.equal(hostConfig.scope, FRONTEND_USER_APP_SCOPES);
    assert.equal(hostConfig.clientId, TEST_ENV.OAUTH_FRONTEND_CLIENT_ID);
    assert.equal(hostConfig.clientSecret, TEST_ENV.OAUTH_FRONTEND_CLIENT_SECRET);
    assert.equal(hostConfig.host, 'https://tenant.example.qlikcloud.com');
  });

  it('requires a CSRF token (403)', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    await agent.post('/access-token').expect(403);
    assert.equal(qlik.auth.getAccessToken.mock.callCount(), 0);
  });

  it('returns 502 (not 401) when the token cannot be minted, so the browser does not treat it as an expired session', async () => {
    const qlik = createQlikStub();
    qlik.auth.getAccessToken.mock.mockImplementation(async () => { throw new Error('impersonation not enabled'); });
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    const csrfToken = await getCsrf(agent);

    const res = await agent.post('/access-token').set('CSRF-Token', csrfToken).expect(502);
    assert.deepEqual(res.body, { error: 'authentication_error', message: 'Unable to mint access token' });
  });
});

describe('POST /config', () => {
  it('returns the embed parameters and the user email', async () => {
    const { app } = buildApp();
    const { agent } = await login(app, 'jane@test.com');
    const csrfToken = await getCsrf(agent);
    const res = await agent.post('/config').set('CSRF-Token', csrfToken).expect(200);

    assert.deepEqual(res.body, {
      tenantUri: 'https://tenant.example.qlikcloud.com',
      oAuthFrontEndClientId: TEST_ENV.OAUTH_FRONTEND_CLIENT_ID,
      appId: TEST_ENV.APP_ID,
      sheetId: TEST_ENV.SHEET_ID,
      objectId: TEST_ENV.OBJECT_ID,
      fieldId: TEST_ENV.FIELD_ID,
      assistantId: TEST_ENV.ASSISTANT_ID,
      agenticAssistantId: TEST_ENV.AGENTIC_ASSISTANT_ID,
      hypercubeDimension: TEST_ENV.HYPERCUBE_DIMENSION,
      hypercubeMeasure: TEST_ENV.HYPERCUBE_MEASURE,
      masterDimension: TEST_ENV.MASTER_DIMENSION,
      masterMeasure: TEST_ENV.MASTER_MEASURE,
      userEmail: 'jane@test.com',
    });
  });

  it('never exposes OAuth client secrets or the session secret', async () => {
    const { app } = buildApp();
    const { agent } = await login(app);
    const csrfToken = await getCsrf(agent);
    const res = await agent.post('/config').set('CSRF-Token', csrfToken).expect(200);

    for (const secret of [
      TEST_ENV.OAUTH_BACKEND_CLIENT_SECRET,
      TEST_ENV.OAUTH_FRONTEND_CLIENT_SECRET,
      TEST_ENV.SESSION_SECRET,
      TEST_ENV.OAUTH_BACKEND_CLIENT_ID,
    ]) {
      assert.ok(!res.text.includes(secret), `response must not contain ${secret}`);
    }
    assert.ok(!Object.keys(res.body).some((k) => /secret/i.test(k)));
  });

  it('requires a CSRF token (403)', async () => {
    const { app } = buildApp();
    const { agent } = await login(app);
    await agent.post('/config').expect(403);
  });
});

describe('GET /app-sheets', () => {
  it('returns the sheet list from an app session opened for the session user', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    const res = await agent.get('/app-sheets').expect(200);

    assert.equal(res.body.length, 2);
    // home.html gets the same sessions opened, so every call must be user-scoped
    for (const call of qlik.qix.openAppSession.mock.calls) {
      const [{ appId, hostConfig }] = call.arguments;
      assert.equal(appId, TEST_ENV.APP_ID);
      assert.equal(hostConfig.userId, 'existing-user-id');
      assert.equal(hostConfig.clientId, TEST_ENV.OAUTH_FRONTEND_CLIENT_ID);
      assert.equal(hostConfig.scope, FRONTEND_USER_APP_SCOPES);
    }
  });

  it('passes the engine status code and error details through', async () => {
    const qlik = createQlikStub();
    qlik.doc.getSheetList.mock.mockImplementation(async () => { throw qixError({ status: 503 }); });
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    const res = await agent.get('/app-sheets').expect(503);

    assert.equal(res.body.error, 'Unable to retrieve sheet definitions');
    assert.equal(res.body.code, 'QIX_ERR');
    assert.equal(res.body.message, 'engine said no');
    assert.equal(res.body.enigmaError, true);
    assert.match(res.body.stack, /engine said no/);
  });

  it('defaults to 500 and hides the stack trace in production', async () => {
    const qlik = createQlikStub();
    qlik.doc.getSheetList.mock.mockImplementation(async () => { throw new Error('boom'); });
    const { app } = buildApp({ qlik, env: { NODE_ENV: 'production' } });
    const { agent } = await loginOverHttps(app);
    const res = await agent.get('/app-sheets').expect(500);

    assert.equal(res.body.message, 'boom');
    assert.equal(res.body.enigmaError, false);
    assert.equal(res.body.stack, undefined);
  });
});

describe('GET /hypercube', () => {
  for (const rowCount of [0, 3, HYPERCUBE_PAGE_HEIGHT, HYPERCUBE_PAGE_HEIGHT + 1, 23]) {
    it(`returns every row exactly once for ${rowCount} rows`, async () => {
      const qlik = createQlikStub({ hypercubeRows: makeRows(rowCount) });
      const { app } = buildApp({ qlik });
      const { agent } = await login(app);
      const res = await agent.get('/hypercube').expect(200);

      const expected = makeRows(rowCount);
      assert.deepEqual(res.body.returnedDimension, expected.map((r) => r[0].qText));
      assert.deepEqual(res.body.returnedMeasure, expected.map((r) => r[1].qText));
    });
  }

  it('builds the hypercube from the configured dimension and measure', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    await agent.get('/hypercube').expect(200);

    const { qHyperCubeDef } = qlik.models[0].properties;
    assert.deepEqual(qHyperCubeDef.qDimensions[0].qDef.qFieldDefs, [TEST_ENV.HYPERCUBE_DIMENSION]);
    assert.equal(qHyperCubeDef.qMeasures[0].qDef.qDef, TEST_ENV.HYPERCUBE_MEASURE);
  });

  it('stops paging if the engine returns an empty page', async () => {
    const qlik = createQlikStub({ hypercubeRows: makeRows(15) });
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    // Make the first follow-up page come back empty
    qlik.doc.createSessionObject.mock.mockImplementationOnce(async (properties) => {
      const model = {
        id: 'short-model',
        properties,
        getLayout: async () => ({
          qHyperCube: { qSize: { qcx: 2, qcy: 15 }, qDataPages: [{ qMatrix: makeRows(10) }] },
        }),
        getHyperCubeData: async () => [{ qMatrix: [] }],
      };
      qlik.models.push(model);
      return model;
    });
    const res = await agent.get('/hypercube').expect(200);
    assert.equal(res.body.returnedDimension.length, 10);
  });

  it('destroys the session object on success and on failure', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    await agent.get('/hypercube').expect(200);
    assert.equal(qlik.doc.destroySessionObject.mock.callCount(), 1);
    assert.deepEqual(qlik.doc.destroySessionObject.mock.calls[0].arguments, ['session-object-1']);

    qlik.doc.createSessionObject.mock.mockImplementationOnce(async () => ({
      id: 'failing-model',
      getLayout: async () => { throw qixError({ status: 400, message: 'bad field' }); },
    }));
    const res = await agent.get('/hypercube').expect(400);
    assert.equal(res.body.error, 'Unable to retrieve hypercube data');
    assert.equal(res.body.message, 'bad field');
    assert.deepEqual(qlik.doc.destroySessionObject.mock.calls[1].arguments, ['failing-model']);
  });
});

describe('GET /user-attributes', () => {
  it('returns the session user id and the engine OSUser() value', async () => {
    const qlik = createQlikStub({ osUser: 'UserDirectory=; UserId=oauth_gen_jane@test.com' });
    const { app } = buildApp({ qlik });
    const { agent } = await login(app, 'jane@test.com');
    const res = await agent.get('/user-attributes').expect(200);

    assert.deepEqual(res.body, {
      sessionUserId: 'existing-user-id',
      qlikUserId: 'UserDirectory=; UserId=oauth_gen_jane@test.com',
    });
    assert.deepEqual(qlik.doc.evaluateEx.mock.calls[0].arguments, ['=OSUser()']);
  });

  it('returns a JSON error when the engine call fails', async () => {
    const qlik = createQlikStub();
    qlik.doc.evaluateEx.mock.mockImplementation(async () => { throw qixError(); });
    const { app } = buildApp({ qlik });
    const { agent } = await login(app);
    const res = await agent.get('/user-attributes').expect(500);
    assert.equal(res.body.error, 'Unable to retrieve user attributes');
  });
});

/**
 * Login flow for NODE_ENV=production. The session cookie is Secure there, and supertest's
 * cookie jar will not send Secure cookies over plain HTTP, so carry cookies by hand and
 * mark every request as coming through a TLS-terminating proxy.
 * Returns a minimal agent-like object with `get(path)`.
 */
async function loginOverHttps(app) {
  const jar = new Map();
  const remember = (res) => {
    for (const c of res.headers['set-cookie'] || []) {
      const [pair] = c.split(';');
      jar.set(pair.split('=')[0], pair);
    }
    return res;
  };
  const send = (req) => req.set('X-Forwarded-Proto', 'https').set('Cookie', [...jar.values()].join('; '));

  const { body } = remember(await send(request(app).get('/csrf-token')).expect(200));
  remember(await send(request(app).post('/login').type('form').send({ email: 'a@test.com', _csrf: body.csrfToken })).expect(302));
  remember(await send(request(app).get('/')).expect(200));
  return { agent: { get: (path) => send(request(app).get(path)) } };
}
