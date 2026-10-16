import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent } from '../src/journal.js';
import { reconcileCandidates, ticketSummary } from '../src/reconcile.js';
import { fakeOp, journalHome, noteEvent, wp } from './helpers.js';

const DAY = '2026-10-16';
test('ticketSummary keeps what Claude needs to judge a match', () => {
  const long = wp(5, { description: { raw: 'x'.repeat(1500) } });
  assert.deepEqual(Object.keys(ticketSummary(long)), ['id', 'subject', 'status', 'type', 'version', 'description']);
  assert.equal(ticketSummary(long).description.length, 1000);
  assert.equal(ticketSummary({ id: 1, subject: 's' }).status, 'Unknown');
});

test('candidates: mapped project with matches and open tickets; linked, unmapped and never-ticket projects', async () => {
  const home = journalHome({ tdm: 'demo', scratch: null, notes: false, ext: 'other' });
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't1', commit: 'c'.repeat(40), ticket: '13' }));
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't2', kind: 'bug', status: 'partial', text: 'Refund rounding' }));
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't3', text: 'Already done' }));
  appendEvent(home, 'tdm', DAY, { session: 'S1', source: 'cli', kind: 'ticket_link', note: { ts: 't3', session: 'S1' }, ticket: '99', action: 'closed', opProject: 'demo' });
  appendEvent(home, 'scratch', DAY, noteEvent({ ts: 't4', text: 'Toy' }));
  appendEvent(home, 'notes', DAY, noteEvent({ ts: 't5', text: 'Private' }));
  const ops = {};
  const result = await reconcileCandidates({
    home, date: DAY, configuredProject: 'demo', backlog: 'Backlog: POS',
    opFor: (id) => (ops[id] ??= fakeOp()),
  });
  assert.deepEqual(Object.keys(ops), ['demo']);
  assert.equal(result.date, DAY);
  assert.deepEqual(result.unmapped.map((u) => [u.slug, u.items.map((i) => i.text)]), [['scratch', ['Toy']]]);
  const [tdm] = result.projects;
  assert.deepEqual([tdm.slug, tdm.opProject, tdm.sprint], ['tdm', 'demo', { id: 2165, name: 'Sprint 152' }]);
  assert.deepEqual(tdm.openTickets.map((t) => t.id), [10, 11]);
  assert.deepEqual(tdm.items.map((i) => i.text), ['Add CSV export', 'Refund rounding']);
  assert.deepEqual(tdm.items[0].note, { ts: 't1', session: 'S1' });
  assert.deepEqual(tdm.items[0].matches.map((m) => m.id), [13, 12, 10]);
  assert.deepEqual([tdm.items[1].commit, tdm.items[1].ticket, tdm.items[1].matches], [null, null, []]);
});

test('candidates: backlog only for the configured project; a missing note ticket is skipped', async () => {
  const home = journalHome({ tdm: 'other' });
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't1', ticket: '404' }));
  const op = fakeOp({
    getWorkPackage: async () => { throw Object.assign(new Error('GET -> 404'), { status: 404 }); },
    listMyOpenInVersion: async (versionId) => { op.calls.push(['open', versionId]); return []; },
  });
  const result = await reconcileCandidates({ home, date: DAY, configuredProject: 'demo', backlog: 'Backlog: POS', opFor: () => op });
  assert.deepEqual(op.calls, [['open', 2165]]);
  assert.deepEqual(result.projects[0].items[0].matches.map((m) => m.id), [12, 10]);
});

test('candidates: one failing project reports an error, others still come back', async () => {
  const home = journalHome({ bad: 'gone', tdm: 'demo' });
  appendEvent(home, 'bad', DAY, noteEvent({ ts: 't1' }));
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't2' }));
  const result = await reconcileCandidates({
    home, date: DAY, configuredProject: 'demo', backlog: null,
    opFor: (id) => (id === 'gone' ? fakeOp({ listVersions: async () => { throw new Error('GET /api/v3/projects/gone/versions -> 404: not found'); } }) : fakeOp()),
  });
  assert.deepEqual(result.projects.map((p) => [p.slug, p.error ?? 'ok']), [['bad', 'GET /api/v3/projects/gone/versions -> 404: not found'], ['tdm', 'ok']]);
});

test('candidates: a day with no journal is empty', async () => {
  const home = journalHome({});
  assert.deepEqual(await reconcileCandidates({ home, date: DAY, configuredProject: 'demo', backlog: null, opFor: () => fakeOp() }), {
    date: DAY, configuredProject: 'demo', projects: [], unmapped: [],
  });
});

test('candidates: work created but not yet closed comes back with its link', async () => {
  const home = journalHome({ tdm: 'demo' });
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't1', commit: 'c'.repeat(40) }));
  appendEvent(home, 'tdm', DAY, { session: 'S1', source: 'cli', kind: 'ticket_link', note: { ts: 't1', session: 'S1' }, ticket: '301', action: 'created', opProject: 'demo' });
  const result = await reconcileCandidates({ home, date: DAY, configuredProject: 'demo', backlog: null, opFor: () => fakeOp() });
  assert.deepEqual(result.projects[0].items.map((i) => [i.text, i.ticket, i.link]), [['Add CSV export', '301', { ticket: '301', action: 'created' }]]);
});
