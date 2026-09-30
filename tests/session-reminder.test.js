import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REMINDER, reminderOutput } from '../scripts/session-reminder.js';

test('reminderOutput hands the reminder to Claude as SessionStart context', () => {
  assert.deepEqual(JSON.parse(reminderOutput()), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: REMINDER },
  });
});

test('the reminder names the typed commands and forbids running them unasked', () => {
  for (const cmd of ['/plan-feature', '/done-tasks', '/report-day']) assert.match(REMINDER, new RegExp(cmd));
  assert.match(REMINDER, /once/);
  assert.match(REMINDER, /never run/i);
});

test('running the script prints the hook output', () => {
  const script = fileURLToPath(new URL('../scripts/session-reminder.js', import.meta.url));
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim(), reminderOutput());
});
