import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reminderOutput, reminderText } from '../scripts/session-reminder.js';

const SCRIPT = fileURLToPath(new URL('../scripts/session-reminder.js', import.meta.url));

test('reminderOutput hands the text to Claude as SessionStart context', () => {
  assert.deepEqual(JSON.parse(reminderOutput({ configured: true })), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reminderText({ configured: true }) },
  });
});

test('configured: names the namespaced commands, once, never run unasked', () => {
  const text = reminderText({ configured: true });
  for (const cmd of ['/opflow:plan-feature', '/opflow:done-tasks', '/opflow:report-day']) assert.ok(text.includes(cmd), cmd);
  assert.match(text, /once/);
  assert.match(text, /never run/i);
  assert.doesNotMatch(text, /\/opflow:setup/);
});

test('not configured: only points to /opflow:setup', () => {
  const text = reminderText({ configured: false });
  assert.match(text, /\/opflow:setup/);
  assert.doesNotMatch(text, /\/opflow:plan-feature/);
  assert.match(text, /never run/i);
});

test('the script checks ~/.opflow/.env to decide', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  const env = { ...process.env, OPFLOW_HOME: home };
  const before = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }).stdout.trim();
  assert.equal(before, reminderOutput({ configured: false }));
  writeFileSync(join(home, '.env'), 'OP_URL=x');
  const after = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }).stdout.trim();
  assert.equal(after, reminderOutput({ configured: true }));
});
