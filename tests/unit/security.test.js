// Route protection, static file exposure and rate limits.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, getCsrf, login, useQuietConsole } from './helpers.js';

useQuietConsole();

describe('protected endpoints without a session', () => {
  const endpoints = [
    ['get', '/app-sheets'],
    ['get', '/hypercube'],
    ['get', '/user-attributes'],
    ['post', '/access-token'],
    ['post', '/config'],
  ];

  for (const [method, path] of endpoints) {
    it(`${method.toUpperCase()} ${path} returns 401 { error: "session_expired" }`, async () => {
      const { app, qlik } = buildApp();
      const res = await request(app)[method](path).expect(401);
      assert.deepEqual(res.body, { error: 'session_expired' });
      assert.equal(qlik.qix.openAppSession.mock.callCount(), 0);
      assert.equal(qlik.auth.getAccessToken.mock.callCount(), 0);
    });
  }

  it('an email-only session (provisioning failed) is still unauthenticated', async () => {
    const { app, qlik } = buildApp();
    qlik.users.getUsers.mock.mockImplementation(async () => { throw new Error('down'); });
    const { agent } = await login(app);
    await agent.get('/app-sheets').expect(401);
  });
});

describe('static files', () => {
  it('serves the asset folders', async () => {
    const { app } = buildApp();
    await request(app).get('/js/script.js').expect(200).expect('Content-Type', /javascript/);
    await request(app).get('/css/styles.css').expect(200);
    await request(app).get('/img/favicon.ico').expect(200);
  });

  for (const path of ['/home.html', '/login.html', '/app.js', '/server.js', '/.env', '/package.json', '/js/../app.js']) {
    it(`does not serve ${path}`, async () => {
      const { app } = buildApp();
      const res = await request(app).get(path);
      assert.notEqual(res.status, 200, `${path} returned 200`);
      assert.doesNotMatch(res.text, /createApp|SESSION_SECRET/);
    });
  }

  it('blocks encoded path traversal out of an asset folder', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/css/%2e%2e/app.js');
    assert.notEqual(res.status, 200);
    assert.doesNotMatch(res.text, /createApp/);
  });
});

describe('rate limits', () => {
  it('limits POST /login', async () => {
    const { app } = buildApp({ rateLimits: { login: 2 } });
    const agent = request.agent(app);
    const csrfToken = await getCsrf(agent);
    const attempt = () => agent.post('/login').type('form').send({ email: 'a@test.com', _csrf: csrfToken });

    assert.equal((await attempt()).status, 302);
    assert.equal((await attempt()).status, 302);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.match(blocked.text, /Too many login attempts/);
    assert.ok(blocked.headers['ratelimit-policy'] || blocked.headers['ratelimit'], 'expected standard RateLimit headers');
  });

  it('limits POST /access-token', async () => {
    const { app } = buildApp({ rateLimits: { token: 1 } });
    const { agent } = await login(app);
    const csrfToken = await getCsrf(agent);
    await agent.post('/access-token').set('CSRF-Token', csrfToken).expect(200);
    const blocked = await agent.post('/access-token').set('CSRF-Token', csrfToken).expect(429);
    assert.match(blocked.text, /Too many token requests/);
  });

  it('limits the page routes', async () => {
    const { app } = buildApp({ rateLimits: { file: 1 } });
    await request(app).get('/login').expect(200);
    await request(app).get('/login').expect(429);
  });
});
