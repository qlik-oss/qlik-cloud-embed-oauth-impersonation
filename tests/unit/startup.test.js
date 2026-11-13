import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ENV } from '../support/qlik-stub.js';

const serverPath = fileURLToPath(new URL('../../server.js', import.meta.url));

// Run server.js from an empty directory so dotenv cannot pick up the repo's real .env file
let cwd;
before(() => { cwd = mkdtempSync(path.join(tmpdir(), 'oauth-impersonation-startup-')); });
after(() => rmSync(cwd, { recursive: true, force: true }));

/** Ask the OS for a free port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Start server.js and resolve once it logs that it is listening (or exits). */
function startServer(env) {
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${stdout}\n${stderr}`)), 15000);
    child.stdout.on('data', () => {
      if (stdout.includes('Server running at')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, ready, exited, output: () => ({ stdout, stderr }) };
}

describe('server.js startup', () => {
  it('exits with code 1 and names the missing variables when the env is incomplete', () => {
    const result = spawnSync(process.execPath, [serverPath], {
      cwd,
      env: { PATH: process.env.PATH, APP_ID: 'app-123' },
      encoding: 'utf8',
      timeout: 15000,
    });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /Missing required environment variables/);
    assert.match(result.stderr, /SESSION_SECRET/);
    assert.match(result.stderr, /OAUTH_FRONTEND_CLIENT_SECRET/);
    assert.doesNotMatch(result.stderr, /APP_ID/, 'APP_ID was provided and should not be reported');
  });

  it('starts with the real @qlik/api, normalizes TENANT_URI and serves /login', async () => {
    const port = await freePort();
    // TEST_ENV's TENANT_URI has no scheme, so server.js should log the normalized value.
    // Serving /login makes no Qlik Cloud calls, so no tenant is needed.
    const server = startServer({ ...TEST_ENV, PORT: String(port) });
    try {
      assert.equal(await server.ready, undefined, `server exited early\n${server.output().stderr}`);
      const { stdout } = server.output();
      assert.match(stdout, /Using normalized TENANT_URI: https:\/\/tenant\.example\.qlikcloud\.com/);
      assert.match(stdout, new RegExp(`Server running at http://localhost:${port}`));

      const res = await fetch(`http://localhost:${port}/login`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /loginButton/);

      const unauthenticated = await fetch(`http://localhost:${port}/app-sheets`);
      assert.equal(unauthenticated.status, 401);
    } finally {
      server.child.kill();
      await server.exited;
    }
  });

  it('does not log a normalized TENANT_URI when it already has a scheme', async () => {
    const port = await freePort();
    const server = startServer({ ...TEST_ENV, TENANT_URI: 'https://tenant.example.qlikcloud.com', PORT: String(port) });
    try {
      assert.equal(await server.ready, undefined, `server exited early\n${server.output().stderr}`);
      assert.doesNotMatch(server.output().stdout, /normalized TENANT_URI/);
    } finally {
      server.child.kill();
      await server.exited;
    }
  });

  it('exits with code 1 and a clear message when the port is already in use', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const { port } = blocker.address();
    try {
      const server = startServer({ ...TEST_ENV, PORT: String(port) });
      const code = await server.exited;
      assert.equal(code, 1);
      assert.match(server.output().stderr, new RegExp(`Port ${port} is already in use`));
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
