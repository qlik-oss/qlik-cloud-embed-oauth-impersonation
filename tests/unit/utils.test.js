import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTenantUri,
  escapeODataString,
  findMissingEnvVars,
  REQUIRED_ENV_VARS,
} from '../../src/app.js';
import { TEST_ENV } from './helpers.js';

describe('normalizeTenantUri', () => {
  it('adds https:// to a bare hostname', () => {
    assert.equal(normalizeTenantUri('t.eu.qlikcloud.com'), 'https://t.eu.qlikcloud.com');
  });

  it('keeps an existing https:// or http:// scheme (case-insensitive)', () => {
    assert.equal(normalizeTenantUri('https://t.eu.qlikcloud.com'), 'https://t.eu.qlikcloud.com');
    assert.equal(normalizeTenantUri('HTTPS://t.eu.qlikcloud.com'), 'HTTPS://t.eu.qlikcloud.com');
    assert.equal(normalizeTenantUri('http://localhost:8080'), 'http://localhost:8080');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizeTenantUri('  t.eu.qlikcloud.com \n'), 'https://t.eu.qlikcloud.com');
  });

  it('returns an empty string for empty or missing input', () => {
    assert.equal(normalizeTenantUri(''), '');
    assert.equal(normalizeTenantUri('   '), '');
    assert.equal(normalizeTenantUri(undefined), '');
  });
});

describe('escapeODataString', () => {
  it('removes double quotes so a value cannot close the OData string literal', () => {
    assert.equal(escapeODataString('a" or status eq "disabled'), 'a or status eq disabled');
  });

  it('leaves normal email addresses unchanged', () => {
    assert.equal(escapeODataString('oauth_gen_jane.doe+1@test.com'), 'oauth_gen_jane.doe+1@test.com');
  });

  it('coerces non-strings', () => {
    assert.equal(escapeODataString(42), '42');
  });
});

describe('findMissingEnvVars', () => {
  it('returns nothing when every required variable is set', () => {
    assert.deepEqual(findMissingEnvVars(TEST_ENV), []);
  });

  it('lists every missing or empty variable', () => {
    assert.deepEqual(findMissingEnvVars({}), REQUIRED_ENV_VARS);
    const env = { ...TEST_ENV, APP_ID: '', SESSION_SECRET: undefined };
    assert.deepEqual(findMissingEnvVars(env), ['SESSION_SECRET', 'APP_ID']);
  });
});
