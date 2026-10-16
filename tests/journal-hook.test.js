import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, journalDir, listSlugs, readEvents } from '../src/journal.js';
import { localDate } from '../src/payloads.js';
import { handleHook } from '../scripts/journal-hook.js';
import { reminderText } from '../scripts/session-reminder.js';
import { gitIn, makeRepo } from './helpers.js';

const SCRIPT = fileURLToPath(new URL('../scripts/journal-hook.js', import.meta.url));
const DAY = '2026-10-16';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo('tdm');
  const hook = (input, over = {}) =>
    handleHook({ session_id: 'S1', cwd: repo, ...input }, { home, today: DAY, configured: true, pluginRoot: '/plug', ...over });
  return { home, repo, hook, events: () => readEvents(home, 'tdm', DAY).events };
}

const context = (out) => JSON.parse(out).hookSpecificOutput.additionalContext;

test('SessionStart startup: records the start and gives reminder + journal context', () => {
  const s = setup();
  const out = s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(context(out).startsWith(reminderText({ configured: true })));
  assert.match(context(out), /opflow journal — project "tdm", session S1\./);
  assert.match(context(out), /node "\/plug\/bin\/opflow\.js" journal:note --session S1/);
  const [start] = s.events();
  assert.deepEqual(
    { kind: start.kind, session: start.session, source: start.source, trigger: start.trigger, head: start.head },
    { kind: 'session_start', session: 'S1', source: 'hook', trigger: 'startup', head: gitIn(s.repo, 'rev-parse', 'HEAD') },
  );
  assert.ok(start.branch);
});

test('SessionStart resume/clear/compact: context without the reminder', () => {
  const s = setup();
  for (const source of ['resume', 'clear', 'compact']) {
    const text = context(s.hook({ hook_event_name: 'SessionStart', source }));
    assert.ok(!text.includes(reminderText({ configured: true })), source);
    assert.match(text, /opflow journal — project "tdm"/);
  }
  assert.deepEqual(s.events().map((e) => e.trigger), ['resume', 'clear', 'compact']);
});

test('SessionStart: not configured -> setup reminder; previous-day partials in context', () => {
  const s = setup();
  appendEvent(s.home, 'tdm', '2026-10-14', { session: 'S0', source: 'claude', kind: 'bug', status: 'partial', text: 'Old' });
  appendEvent(s.home, 'tdm', '2026-10-15', { session: 'S0', source: 'claude', kind: 'bug', status: 'partial', text: 'Refund rounding' });
  const text = context(s.hook({ hook_event_name: 'SessionStart', source: 'startup' }, { configured: false }));
  assert.ok(text.startsWith(reminderText({ configured: false })));
  assert.match(text, /Unfinished from 2026-10-15:\n- Refund rounding \[partial\]/);
  assert.doesNotMatch(text, /Old/);
});

test('PostToolUse: a new commit is recorded once; non-commit commands do nothing', () => {
  const s = setup();
  s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } }), '');
  gitIn(s.repo, 'commit', '-q', '--allow-empty', '-m', 'feat: csv export');
  const commit = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "feat: csv export"' } };
  assert.equal(s.hook(commit), '');
  s.hook(commit);
  const commits = s.events().filter((e) => e.kind === 'commit');
  assert.equal(commits.length, 1);
  assert.deepEqual([commits[0].hash, commits[0].subject, commits[0].session], [gitIn(s.repo, 'rev-parse', 'HEAD'), 'feat: csv export', 'S1']);
});

test('PostToolUse: "commit" in a command without a new commit records nothing', () => {
  const s = setup();
  s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git log --grep commit' } });
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell', tool_input: { command: 'git commit -m "nothing staged"' } });
  assert.deepEqual(s.events().map((e) => e.kind), ['session_start']);
});

test('PostToolUse: a non-commit command never touches ~/.opflow', () => {
  const s = setup();
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(listSlugs(s.home), []);
  assert.equal(existsSync(join(s.home, 'projects.json')), false);
});

test('SessionEnd records the end with HEAD and reason', () => {
  const s = setup();
  assert.equal(s.hook({ hook_event_name: 'SessionEnd', reason: 'logout' }), '');
  const [end] = s.events();
  assert.deepEqual([end.kind, end.reason, end.head], ['session_end', 'logout', gitIn(s.repo, 'rev-parse', 'HEAD')]);
});

test('script: reads stdin, uses OPFLOW_HOME and today, checks .env for the reminder', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo('tdm');
  const run = () =>
    spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'S1', cwd: repo }),
      env: { ...process.env, OPFLOW_HOME: home },
      encoding: 'utf8',
    });
  const before = run();
  assert.equal(before.status, 0);
  assert.ok(context(before.stdout).startsWith(reminderText({ configured: false })));
  assert.equal(readEvents(home, 'tdm', localDate()).events.length, 1);
  writeFileSync(join(home, '.env'), 'OP_URL=x');
  assert.ok(context(run().stdout).startsWith(reminderText({ configured: true })));
});

test('script: never fails the session; logs errors; startup still gets the reminder', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const bad = spawnSync(process.execPath, [SCRIPT], { input: 'not json', env: { ...process.env, OPFLOW_HOME: home }, encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.match(readFileSync(join(journalDir(home), 'errors.log'), 'utf8'), /SyntaxError/);

  const fileHome = join(home, 'not-a-dir');
  writeFileSync(fileHome, 'x');
  const broken = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'S1', cwd: makeRepo() }),
    env: { ...process.env, OPFLOW_HOME: fileHome },
    encoding: 'utf8',
  });
  assert.equal(broken.status, 0);
  assert.equal(context(broken.stdout), reminderText({ configured: false }));
});
