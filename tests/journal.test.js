import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEvent, collapseItems, journalDir, journalFile, knownHead, latestSession, listDates, listSlugs, readEvents,
  sessionsWithoutEnd, unlinkedCommit,
} from '../src/journal.js';

const tempHome = () => mkdtempSync(join(tmpdir(), 'opflow-home-'));
const DAY = '2026-10-16';
const note = (over) => ({ session: 's1', source: 'claude', kind: 'feature', status: 'done', text: 'Add CSV export', ...over });

test('appendEvent + readEvents round-trip, one line per event, ts added', () => {
  const home = tempHome();
  appendEvent(home, 'tdm', DAY, note({ text: 'Line one\nline "two" ✓' }));
  appendEvent(home, 'tdm', DAY, { session: 's1', source: 'hook', kind: 'commit', hash: 'abc', subject: 'x', ts: 'fixed' });
  const raw = readFileSync(journalFile(home, 'tdm', DAY), 'utf8');
  assert.equal(raw.split('\n').filter(Boolean).length, 2);
  const { events, skipped } = readEvents(home, 'tdm', DAY);
  assert.equal(skipped, 0);
  assert.equal(events[0].text, 'Line one\nline "two" ✓');
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(events[1].ts, 'fixed');
});

test('readEvents: missing file is empty; bad lines are skipped and counted', () => {
  const home = tempHome();
  assert.deepEqual(readEvents(home, 'tdm', DAY), { events: [], skipped: 0 });
  mkdirSync(join(journalDir(home), 'tdm'), { recursive: true });
  writeFileSync(journalFile(home, 'tdm', DAY), `{"kind":"feature","text":"ok","status":"done"}\nnot json\n{}\n\n[1]\n`);
  const { events, skipped } = readEvents(home, 'tdm', DAY);
  assert.equal(events.length, 1);
  assert.equal(skipped, 3);
});

test('listDates and listSlugs: sorted, ignore other files', () => {
  const home = tempHome();
  assert.deepEqual(listSlugs(home), []);
  assert.deepEqual(listDates(home, 'tdm'), []);
  for (const d of ['2026-10-16', '2026-10-02', '2026-10-15']) appendEvent(home, 'tdm', d, note());
  appendEvent(home, 'erp', DAY, note());
  writeFileSync(join(journalDir(home), 'errors.log'), 'x');
  writeFileSync(join(journalDir(home), 'tdm', 'notes.txt'), 'x');
  assert.deepEqual(listDates(home, 'tdm'), ['2026-10-02', '2026-10-15', '2026-10-16']);
  assert.deepEqual(listSlugs(home), ['erp', 'tdm']);
});

test('concurrent appends from several processes never interleave', async () => {
  const home = tempHome();
  const url = new URL('../src/journal.js', import.meta.url).href;
  const script = `const { appendEvent } = await import(${JSON.stringify(url)});
    for (let i = 0; i < 50; i++) appendEvent(process.env.H, 'tdm', '${DAY}', { session: process.env.S, source: 'claude', kind: 'feature', status: 'done', text: 'x'.repeat(500) + i });`;
  await Promise.all(['a', 'b', 'c', 'd'].map((s) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, H: home, S: s } });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  })));
  const { events, skipped } = readEvents(home, 'tdm', DAY);
  assert.equal(skipped, 0);
  assert.equal(events.length, 200);
});

test('collapseItems: latest note per item wins; text match ignores case and spacing', () => {
  const items = collapseItems([
    note({ status: 'partial', text: 'Add CSV  export' }),
    { kind: 'commit', session: 's1', hash: 'h1' },
    note({ kind: 'bug', text: 'Fix rounding' }),
    note({ status: 'done', text: 'add csv export' }),
  ]);
  assert.deepEqual(items.map((i) => [i.kind, i.text, i.status]), [['bug', 'Fix rounding', 'done'], ['feature', 'add csv export', 'done']]);
});

test('collapseItems: same ticket is one item; a later note without a commit keeps the earlier commit', () => {
  const items = collapseItems([
    note({ ticket: '123', text: 'Export v1', status: 'partial', commit: 'h1' }),
    note({ ticket: '123', text: 'Export finished', status: 'done' }),
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].text, items[0].status, items[0].commit], ['Export finished', 'done', 'h1']);
});

test('session helpers', () => {
  const events = [
    { kind: 'session_start', session: 's1', head: 'h0' },
    { kind: 'commit', session: 's1', hash: 'h1' },
    note({ commit: 'h1' }),
    { kind: 'commit', session: 's1', hash: 'h2' },
    { kind: 'session_start', session: 's2', head: 'h2' },
    { kind: 'session_end', session: 's2' },
    { kind: 'session_start', session: 's2', head: 'h2' },
    { kind: 'session_start', session: 's3' },
    { kind: 'session_end', session: 's3' },
  ];
  assert.equal(latestSession(events), 's3');
  assert.equal(latestSession([]), null);
  assert.equal(unlinkedCommit(events, 's1'), 'h2');
  assert.equal(unlinkedCommit(events.slice(0, 3), 's1'), null);
  assert.equal(unlinkedCommit(events, 's2'), null);
  assert.equal(knownHead(events, 's1'), 'h2');
  assert.equal(knownHead(events, 's2'), 'h2');
  assert.equal(knownHead(events, 's3'), null);
  assert.deepEqual(sessionsWithoutEnd(events, 's9'), ['s1', 's2']);
  assert.deepEqual(sessionsWithoutEnd(events, 's1'), ['s2']);
});
