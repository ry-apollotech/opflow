import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, readEvents } from '../src/journal.js';
import { parseFlags, runJournal } from '../src/journal-cli.js';
import { gitIn, makeRepo } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/opflow.js', import.meta.url));
const DAY = '2026-10-16';

function setup(name = 'tdm') {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo(name);
  const lines = [];
  const run = (argv, cwd = repo) => runJournal(argv, { home, cwd, today: DAY, log: (l) => lines.push(l) });
  return { home, repo, lines, run, events: (slug = name) => readEvents(home, slug, DAY).events };
}

const NOTE = ['journal:note', '--kind', 'feature', '--status', 'done', '--text', 'Add CSV export'];

test('parseFlags: values and --json; missing value is an error', () => {
  assert.deepEqual(parseFlags(['--kind', 'bug', '--json']), { kind: 'bug', json: true });
  assert.throws(() => parseFlags(['--kind']), /--kind needs a value/);
  assert.throws(() => parseFlags(['--kind', '--text', 'x']), /--kind needs a value/);
  assert.throws(() => parseFlags(['stray']), /Unexpected argument: stray/);
});

test('journal:note records a claude note under the given session and links its unused commit', () => {
  const s = setup();
  appendEvent(s.home, 'tdm', DAY, { session: 'S1', source: 'hook', kind: 'commit', hash: 'f'.repeat(40), subject: 'x' });
  assert.equal(s.run([...NOTE, '--session', 'S1', '--ticket', '123']), 0);
  const note = s.events().at(-1);
  assert.deepEqual(
    { session: note.session, source: note.source, kind: note.kind, status: note.status, text: note.text, ticket: note.ticket, commit: note.commit },
    { session: 'S1', source: 'claude', kind: 'feature', status: 'done', text: 'Add CSV export', ticket: '123', commit: 'f'.repeat(40) },
  );
  assert.equal(s.lines.at(-1), 'Noted in tdm: Add CSV export [done] (commit fffffff)');
});

test('journal:note without --session uses the latest session today, else "unknown"; no commit -> not committed', () => {
  const s = setup();
  s.run(NOTE);
  assert.equal(s.events().at(-1).session, 'unknown');
  assert.equal(s.events().at(-1).commit, undefined);
  assert.match(s.lines.at(-1), /\(not committed\)$/);
  appendEvent(s.home, 'tdm', DAY, { session: 'S2', source: 'hook', kind: 'session_start' });
  s.run(NOTE);
  assert.equal(s.events().at(-1).session, 'S2');
});

test('journal:note --commit resolves a short hash in the repo; unknown or malformed hashes fail', () => {
  const s = setup();
  gitIn(s.repo, 'commit', '-q', '--allow-empty', '-m', 'feat: export');
  const full = gitIn(s.repo, 'rev-parse', 'HEAD');
  assert.equal(s.run([...NOTE, '--commit', full.slice(0, 7)]), 0);
  assert.equal(s.events().at(-1).commit, full);
  assert.equal(s.run([...NOTE, '--commit', 'deadbeef']), 1);
  assert.match(s.lines.at(-1), /^Error: Commit deadbeef not found in /);
  assert.equal(s.run([...NOTE, '--commit', 'HEAD~1;rm']), 1);
  assert.match(s.lines.at(-1), /^Error: --commit must be a commit hash/);
});

test('journal:note validation', () => {
  const s = setup();
  const cases = [
    [['journal:note', '--status', 'done', '--text', 'x'], /--kind must be feature or bug/],
    [['journal:note', '--kind', 'test', '--status', 'done', '--text', 'x'], /--kind must be feature or bug/],
    [['journal:note', '--kind', 'bug', '--status', 'finished', '--text', 'x'], /--status must be done or partial/],
    [['journal:note', '--kind', 'bug', '--status', 'done', '--text', '   '], /--text is required/],
    [['journal:note', '--kind', 'bug', '--status', 'done', '--text', 'x'.repeat(201)], /longer than 200/],
    [[...NOTE, '--ticket', '#12'], /--ticket must be a work package number/],
    [[...NOTE, '--verbose', 'x'], /Unknown flag: --verbose/],
  ];
  for (const [argv, message] of cases) {
    assert.equal(s.run(argv), 1, argv.join(' '));
    assert.match(s.lines.at(-1), message);
  }
  assert.deepEqual(s.events(), []);
});

test('journal:note: multi-line text with quotes becomes one line', () => {
  const s = setup();
  s.run(['journal:note', '--kind', 'bug', '--status', 'partial', '--text', 'Fix "refund"\n  rounding ✓']);
  assert.equal(s.events().at(-1).text, 'Fix "refund" rounding ✓');
});

test('journal:show: nothing, all projects, one project, json', () => {
  const s = setup();
  assert.equal(s.run(['journal:show']), 0);
  assert.equal(s.lines.at(-1), `Nothing recorded for ${DAY}.`);
  s.run([...NOTE, '--session', 'S1']);
  appendEvent(s.home, 'erp', DAY, { session: 'S9', source: 'claude', kind: 'bug', status: 'done', text: 'Dup receipts', commit: 'a'.repeat(40) });
  s.lines.length = 0;
  s.run(['journal:show']);
  assert.equal(s.lines.join('\n'), `# Journal — ${DAY}\n\n## erp\n\n**Bugs fixed**\n- Dup receipts [done] (commit aaaaaaa)\n\n## tdm\n\n**Features**\n- Add CSV export [done] (not committed)`);
  s.lines.length = 0;
  s.run(['journal:show', '--project', 'erp', '--json']);
  const json = JSON.parse(s.lines.join('\n'));
  assert.equal(json.date, DAY);
  assert.deepEqual(json.projects.map((p) => [p.slug, p.items.length, p.skipped]), [['erp', 1, 0]]);
});

test('journal:show rejects bad --project and --date', () => {
  const s = setup();
  assert.equal(s.run(['journal:show', '--project', '../etc']), 1);
  assert.match(s.lines.at(-1), /Invalid project/);
  assert.equal(s.run(['journal:show', '--date', '16/10/2026']), 1);
  assert.match(s.lines.at(-1), /--date must be YYYY-MM-DD/);
});

test('bin: journal commands work before opflow is set up', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo('tdm');
  const env = { ...process.env, OPFLOW_HOME: home, OP_URL: '' };
  const note = spawnSync(process.execPath, [BIN, ...NOTE], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(note.status, 0, note.stdout + note.stderr);
  assert.match(note.stdout, /^Noted in tdm: Add CSV export/);
  const show = spawnSync(process.execPath, [BIN, 'journal:show'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(show.status, 0);
  assert.match(show.stdout, /## tdm/);
});
