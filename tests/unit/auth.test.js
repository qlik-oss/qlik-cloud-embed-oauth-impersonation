// Login, CSRF, user provisioning, sessions and logout — with @qlik/api stubbed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  BACKEND_USER_LOOKUP_SCOPE,
  BACKEND_USER_CREATE_SCOPE,
} from '../../src/app.js';
import {
  TEST_ENV,
  buildApp,
  createQlikStub,
  getCsrf,
  getSetCookie,
  login,
  useQuietConsole,
} from './helpers.js';

useQuietConsole();

describe('GET /login and GET /', () => {
  it('serves the login page', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/login').expect(200);
    assert.match(res.text, /id="loginButton"/);
  });

  it('redirects to /login when there is no session', async () => {
    const { app } = buildApp();
    await request(app).get('/').expect(302).expect('Location', '/login');
  });
});

describe('POST /login', () => {
  it('rejects a request without a CSRF token (403)', async () => {
    const { app } = buildApp();
    await request(app).post('/login').type('form').send({ email: 'a@test.com' }).expect(403);
  });

  it('rejects a request with a wrong CSRF token (403)', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    await getCsrf(agent);
    await agent.post('/login').type('form').send({ email: 'a@test.com', _csrf: 'not-the-token' }).expect(403);
  });

  it('rejects a missing email (400)', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const csrfToken = await getCsrf(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: csrfToken }).expect(400);
    assert.match(res.text, /Please provide an email/);
  });

  it('redirects to / and stores the email in the session', async () => {
    const { app } = buildApp();
    const { agent } = await login(app, 'jane@test.com');
    const csrfToken = await getCsrf(agent);
    const res = await agent.post('/config').set('CSRF-Token', csrfToken).expect(200);
    assert.equal(res.body.userEmail, 'jane@test.com');
  });

  it('issues a new session id on every login and invalidates the old one (session fixation)', async () => {
    const { app } = buildApp();
    const { agent, loginRes: first } = await login(app, 'first@test.com');
    const firstCookie = getSetCookie(first, 'connect.sid');
    assert.ok(firstCookie, 'expected a session cookie after the first login');

    const csrfToken = await getCsrf(agent);
    const second = await agent
      .post('/login')
      .type('form')
      .send({ email: 'second@test.com', _csrf: csrfToken })
      .expect(302);
    const secondCookie = getSetCookie(second, 'connect.sid');
    assert.ok(secondCookie, 'expected a new session cookie after the second login');
    assert.notEqual(secondCookie.split(';')[0], firstCookie.split(';')[0]);

    // The old session id no longer grants access
    await request(app)
      .get('/user-attributes')
      .set('Cookie', firstCookie.split(';')[0])
      .expect(401);
  });
});

describe('session cookie flags', () => {
  it('is HttpOnly and SameSite=Lax, and not Secure outside production', async () => {
    const { app } = buildApp();
    const { loginRes } = await login(app);
    const cookie = getSetCookie(loginRes, 'connect.sid');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /Secure/i);
  });

  it('is Secure in production', async () => {
    const { app } = buildApp({ env: { NODE_ENV: 'production' } });
    const agent = request.agent(app);
    // Behind a TLS-terminating proxy (trust proxy = 1)
    const csrfRes = await agent.get('/csrf-token').set('X-Forwarded-Proto', 'https').expect(200);
    const res = await agent
      .post('/login')
      .set('X-Forwarded-Proto', 'https')
      .type('form')
      .send({ email: 'a@test.com', _csrf: csrfRes.body.csrfToken })
      .expect(302);
    assert.match(getSetCookie(res, 'connect.sid'), /Secure/i);
  });
});

describe('user provisioning on GET /', () => {
  it('reuses an existing Qlik user and looks it up with the prefixed email and backend client', async () => {
    const qlik = createQlikStub({ existingUsers: [{ id: 'existing-user-id' }] });
    const { app } = buildApp({ qlik });
    const { agent, homeRes } = await login(app, 'jane@test.com');

    assert.equal(homeRes.status, 200);
    assert.match(homeRes.text, /<qlik-embed|renderQlikEmbeds/);

    assert.equal(qlik.users.getUsers.mock.callCount(), 1);
    const [query, { hostConfig }] = qlik.users.getUsers.mock.calls[0].arguments;
    assert.equal(query.filter, 'email eq "oauth_gen_jane@test.com" and status eq "active"');
    assert.equal(hostConfig.clientId, TEST_ENV.OAUTH_BACKEND_CLIENT_ID);
    assert.equal(hostConfig.clientSecret, TEST_ENV.OAUTH_BACKEND_CLIENT_SECRET);
    assert.equal(hostConfig.scope, BACKEND_USER_LOOKUP_SCOPE);
    assert.equal(hostConfig.host, 'https://tenant.example.qlikcloud.com');
    assert.equal(qlik.users.createUser.mock.callCount(), 0);

    const attrs = await agent.get('/user-attributes').expect(200);
    assert.equal(attrs.body.sessionUserId, 'existing-user-id');
  });

  it('creates the Qlik user when none exists', async () => {
    const qlik = createQlikStub({ existingUsers: [] });
    const { app } = buildApp({ qlik });
    const { agent, homeRes } = await login(app, 'new@test.com');

    assert.equal(homeRes.status, 200);
    assert.equal(qlik.users.createUser.mock.callCount(), 1);
    const [body, { hostConfig }] = qlik.users.createUser.mock.calls[0].arguments;
    assert.deepEqual(body, {
      name: 'oauth_gen_new@test.com',
      email: 'oauth_gen_new@test.com',
      subject: 'oauth_gen_new@test.com',
      status: 'active',
    });
    assert.equal(hostConfig.clientId, TEST_ENV.OAUTH_BACKEND_CLIENT_ID);
    assert.equal(hostConfig.scope, BACKEND_USER_CREATE_SCOPE);

    const attrs = await agent.get('/user-attributes').expect(200);
    assert.equal(attrs.body.sessionUserId, 'created-user-id');
  });

  it('honours a custom USER_PREFIX, including an empty one', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik, env: { USER_PREFIX: '' } });
    await login(app, 'plain@test.com');
    const [query] = qlik.users.getUsers.mock.calls[0].arguments;
    assert.equal(query.filter, 'email eq "plain@test.com" and status eq "active"');
  });

  it('strips double quotes from the email in the OData filter', async () => {
    const qlik = createQlikStub();
    const { app } = buildApp({ qlik });
    await login(app, 'x" or status eq "disabled');
    const [query] = qlik.users.getUsers.mock.calls[0].arguments;
    assert.equal(query.filter, 'email eq "oauth_gen_x or status eq disabled" and status eq "active"');
  });

  it('returns 500 and clears the session when the Qlik user lookup fails', async () => {
    const qlik = createQlikStub();
    qlik.users.getUsers.mock.mockImplementation(async () => { throw new Error('tenant unreachable'); });
    const { app } = buildApp({ qlik });
    const { agent, homeRes } = await login(app);

    assert.equal(homeRes.status, 500);
    assert.match(homeRes.text, /Error accessing user account/);
    await agent.get('/').expect(302).expect('Location', '/login');
    await agent.get('/user-attributes').expect(401);
  });

  it('returns 500 when creating the Qlik user fails', async () => {
    const qlik = createQlikStub({ existingUsers: [] });
    qlik.users.createUser.mock.mockImplementation(async () => { throw new Error('forbidden'); });
    const { app } = buildApp({ qlik });
    const { homeRes } = await login(app);
    assert.equal(homeRes.status, 500);
  });
});

describe('GET /logout', () => {
  it('destroys the session and redirects to /login', async () => {
    const { app } = buildApp();
    const { agent } = await login(app);
    await agent.get('/user-attributes').expect(200);

    await agent.get('/logout').expect(302).expect('Location', '/login');
    await agent.get('/user-attributes').expect(401);
    await agent.get('/').expect(302).expect('Location', '/login');
  });
});
