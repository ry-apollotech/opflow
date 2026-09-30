import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOT_SET_UP, envFile, loadUserConfig, opflowHome, preferencesFile, reportTemplateFile } from '../src/home.js';

const full = [
  'OP_URL=https://op.test', 'OP_API_KEY=k', 'OP_PROJECT=p', 'NC_URL=https://nc.test',
  'NC_USER=u', 'NC_APP_PASSWORD=pw', 'NC_TALK_ROOM=r',
].join('\n');

test('opflowHome honours OPFLOW_HOME and defaults to ~/.opflow', () => {
  assert.equal(opflowHome({ OPFLOW_HOME: '/x/y' }), '/x/y');
  assert.equal(opflowHome({}), join(homedir(), '.opflow'));
});

test('file helpers live inside the home folder', () => {
  assert.equal(envFile('/h'), join('/h', '.env'));
  assert.equal(preferencesFile('/h'), join('/h', 'preferences.json'));
  assert.equal(reportTemplateFile('/h'), join('/h', 'report-template.md'));
});

test('loadUserConfig says to run setup when nothing is configured', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  assert.throws(() => loadUserConfig(home, {}), { message: NOT_SET_UP });
  assert.equal(NOT_SET_UP, 'opflow is not set up. Run /opflow:setup in Claude Code.');
});

test('loadUserConfig reads <home>/.env', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  writeFileSync(envFile(home), full);
  assert.equal(loadUserConfig(home, {}).op.url, 'https://op.test');
});
