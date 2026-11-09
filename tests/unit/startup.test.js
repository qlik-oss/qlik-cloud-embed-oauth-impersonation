import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../server.js', import.meta.url));

describe('server.js startup', () => {
  it('exits with code 1 and names the missing variables when the env is incomplete', () => {
    // Run from an empty directory so dotenv cannot pick up the repo's real .env file
    const cwd = mkdtempSync(path.join(tmpdir(), 'oauth-impersonation-startup-'));
    try {
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
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
