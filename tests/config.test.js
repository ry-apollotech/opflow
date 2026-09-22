import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, buildConfig, loadConfig, REQUIRED_KEYS } from '../src/config.js';

const full = {
  OP_URL: 'https://op.example.com/',
  OP_API_KEY: 'k',
  OP_PROJECT: 'demo',
  NC_URL: 'https://nc.example.com',
  NC_USER: 'ryan',
  NC_APP_PASSWORD: 'p',
  NC_TALK_ROOM: 'abc123',
};

test('parseEnv reads key=value, skips comments and blanks, strips quotes', () => {
  const env = parseEnv('# comment\n\nOP_URL=https://x\r\nNC_USER="ryan"\nNC_APP_PASSWORD=\'a=b\'\n');
  assert.deepEqual(env, { OP_URL: 'https://x', NC_USER: 'ryan', NC_APP_PASSWORD: 'a=b' });
});

test('buildConfig lists every missing key', () => {
  assert.throws(() => buildConfig({ OP_URL: 'x' }), {
    message: `Missing config keys: ${REQUIRED_KEYS.slice(1).join(', ')}`,
  });
});

test('buildConfig trims trailing slashes and groups by service', () => {
  assert.deepEqual(buildConfig(full), {
    op: { url: 'https://op.example.com', apiKey: 'k', project: 'demo' },
    nc: { url: 'https://nc.example.com', user: 'ryan', appPassword: 'p', room: 'abc123' },
  });
});

test('loadConfig reads the file and lets env override it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dfly-'));
  const file = join(dir, '.env');
  writeFileSync(file, Object.entries(full).map(([k, v]) => `${k}=${v}`).join('\n'));
  const config = loadConfig(file, { OP_PROJECT: 'other' });
  assert.equal(config.op.project, 'other');
  assert.equal(config.nc.room, 'abc123');
});

test('loadConfig works without a file when env has everything', () => {
  assert.equal(loadConfig(join(tmpdir(), 'does-not-exist.env'), full).op.apiKey, 'k');
});

test('loadConfig ignores empty-string env values and keeps the .env file value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dfly-'));
  const file = join(dir, '.env');
  writeFileSync(file, Object.entries(full).map(([k, v]) => `${k}=${v}`).join('\n'));
  const config = loadConfig(file, { OP_PROJECT: '', NC_USER: 'other' });
  assert.equal(config.op.project, 'demo');
  assert.equal(config.nc.user, 'other');
});
