import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, planRules } from '../src/preferences.js';

const BIN = fileURLToPath(new URL('../bin/opflow.js', import.meta.url));

function opflow(args, home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OP|NC)_/.test(k)));
  return spawnSync(process.execPath, [BIN, ...args], { env: { ...env, OPFLOW_HOME: home }, encoding: 'utf8', stdio: 'pipe' });
}

const tempHome = () => mkdtempSync(join(tmpdir(), 'opflow-'));

test('plan:rules prints the default rules when nothing is saved', () => {
  const r = opflow(['plan:rules'], tempHome());
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), planRules(DEFAULTS));
});

test('plan:rules follows saved preferences', () => {
  const home = tempHome();
  writeFileSync(join(home, 'preferences.json'), JSON.stringify({ ...DEFAULTS, size: 'fewer' }));
  assert.match(opflow(['plan:rules'], home).stdout, /Never more than 5 stories/);
});

test('commands that need credentials say to run setup first', () => {
  const r = opflow(['check'], tempHome());
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), 'Error: opflow is not set up. Run /opflow:setup in Claude Code.');
});

test('setup without a terminal exits 1 with the command to run', () => {
  const r = opflow(['setup'], tempHome());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /setup needs a terminal/);
  assert.match(r.stderr, /On Windows, use PowerShell or Windows Terminal/);
  assert.ok(r.stderr.includes(`node "${BIN.replaceAll('\\', '/')}" setup`), r.stderr);
});
