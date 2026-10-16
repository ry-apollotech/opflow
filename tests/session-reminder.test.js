import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderText } from '../scripts/session-reminder.js';

test('configured: names the namespaced commands, once, never run unasked except journal:note', () => {
  const text = reminderText({ configured: true });
  for (const cmd of ['/opflow:plan-feature', '/opflow:done-tasks', '/opflow:report-day']) assert.ok(text.includes(cmd), cmd);
  assert.match(text, /once/);
  assert.match(text, /never run/i);
  assert.match(text, /except journal:note/);
  assert.doesNotMatch(text, /\/opflow:setup/);
});

test('not configured: only points to /opflow:setup', () => {
  const text = reminderText({ configured: false });
  assert.match(text, /\/opflow:setup/);
  assert.doesNotMatch(text, /\/opflow:plan-feature/);
  assert.match(text, /never run/i);
});
