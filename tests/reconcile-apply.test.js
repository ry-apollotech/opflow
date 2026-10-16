import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, readEvents } from '../src/journal.js';
import { reconcileApply, validatePlan } from '../src/reconcile.js';
import { fakeOp, journalHome, noteEvent, wp } from './helpers.js';

const DAY = '2026-10-16';
const C = 'c'.repeat(40);

function setup(plan, { projects = { tdm: 'demo' }, op = fakeOp(), backlog = 'Backlog: POS' } = {}) {
  const home = journalHome(projects);
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't1', commit: C }));
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't2', kind: 'bug', status: 'partial', text: 'Refund rounding' }));
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 't3', text: 'Uncommitted export' }));
  const lines = [];
  const removed = [];
  const deps = {
    home, log: (l) => lines.push(l), opFor: () => op, project: 'demo', backlog,
    readFile: async () => JSON.stringify(plan), removeFile: async (f) => { removed.push(f); },
  };
  const apply = (yes = false) => reconcileApply({ file: 'r.json', yes }, deps);
  const links = () => readEvents(home, 'tdm', DAY).events.filter((e) => e.kind === 'ticket_link');
  return { home, op, lines, removed, apply, links, output: () => lines.join('\n') };
}

const ref = (ts) => ({ project: 'tdm', date: DAY, note: { ts, session: 'S1' } });
const closeT1 = { ...ref('t1'), action: 'close', ticket: 10 };
const commentT2 = { ...ref('t2'), action: 'comment', ticket: 11, comment: 'Rounding fixed for refunds; receipts next.' };
const createT1 = { ...ref('t1'), action: 'create', subject: 'Add CSV export', description: 'Done.', points: 2, closed: true };

test('validatePlan: shapes and errors', () => {
  assert.deepEqual(validatePlan([closeT1]), [{ action: 'close', project: 'tdm', date: DAY, note: { ts: 't1', session: 'S1' }, ticket: '10' }]);
  assert.deepEqual(validatePlan([createT1])[0].task, { subject: 'Add CSV export', description: 'Done.', points: 2 });
  assert.equal(validatePlan([createT1])[0].closed, true);
  const bad = [
    [[], /non-empty JSON array/],
    [[{ ...closeT1, action: 'delete' }], /Action 1: action must be close, comment or create/],
    [[{ ...closeT1, ticket: 'abc' }], /Action 1: ticket must be a work package number/],
    [[{ ...commentT2, comment: ' ' }], /Action 1: comment text is required/],
    [[{ ...createT1, points: 3 }], /Action 1: points must be 1, 2 or 4/],
    [[{ ...closeT1, note: { ts: 't1' } }], /Action 1: note \{ts, session\} is required/],
    [[{ ...closeT1, date: 'today' }], /Action 1: date must be YYYY-MM-DD/],
  ];
  for (const [value, message] of bad) assert.throws(() => validatePlan(value), message);
});

test('dry run describes every action and writes nothing', async () => {
  const s = setup([closeT1, commentT2]);
  assert.equal(await s.apply(), 0);
  assert.equal(s.output(), [
    'DRY RUN: nothing is changed. Re-run with --yes to apply.',
    'tdm (OpenProject demo):',
    '  close #10 "WP 10" [In progress] — Add CSV export (commit ccccccc)',
    '  comment #11 "WP 11" [In progress] — Refund rounding: Rounding fixed for refunds; receipts next.',
  ].join('\n'));
  assert.deepEqual(s.op.calls, []);
  assert.deepEqual(s.links(), []);
});

test('--yes applies close and comment, links each note, removes the file', async () => {
  const s = setup([closeT1, commentT2]);
  assert.equal(await s.apply(true), 0);
  assert.deepEqual(s.op.calls, [['close', 10, 12], ['comment', 11, 'Rounding fixed for refunds; receipts next.']]);
  assert.deepEqual(s.links().map((l) => [l.note.ts, l.ticket, l.action, l.opProject, l.source]), [
    ['t1', '10', 'closed', 'demo', 'cli'],
    ['t2', '11', 'commented', 'demo', 'cli'],
  ]);
  assert.deepEqual(s.removed, ['r.json']);
});

test('create closed: Bug type for bugs, current sprint, then Closed; linked as created-closed', async () => {
  const home = journalHome({ tdm: 'demo' });
  const op = fakeOp();
  appendEvent(home, 'tdm', DAY, noteEvent({ ts: 'b1', kind: 'bug', text: 'Duplicate receipts', commit: C }));
  const lines = [];
  const plan = [{ ...ref('b1'), action: 'create', subject: 'Fix duplicate receipts', description: 'Fixed.', points: 1, closed: true }];
  const deps = { home, log: (l) => lines.push(l), opFor: () => op, project: 'demo', backlog: null, readFile: async () => JSON.stringify(plan), removeFile: async () => {} };
  assert.equal(await reconcileApply({ file: 'r.json', yes: false }, deps), 0);
  assert.match(lines.join('\n'), /create Bug "Fix duplicate receipts" \(1 pts\) -> Sprint 152, then Closed/);
  assert.equal(await reconcileApply({ file: 'r.json', yes: true }, deps), 0);
  assert.deepEqual(op.calls, [['create', 'Fix duplicate receipts', { typeId: 8, assigneeId: 3, versionId: 2165 }], ['close', 301, 12]]);
  assert.deepEqual(readEvents(home, 'tdm', DAY).events.filter((e) => e.kind === 'ticket_link').map((l) => [l.ticket, l.action]), [
    ['301', 'created'], ['301', 'created-closed'],
  ]);
});

test('create open: sprint placement by points; no backlog and full sprint means not created', async () => {
  const full = fakeOp({ listMyOpenInVersion: async () => [{ estimatedTime: 'PT120H' }] });
  const s = setup([{ ...ref('t2'), action: 'create', subject: 'Fix refund rounding', description: 'Partly.', points: 2, closed: false }], { op: full, backlog: null });
  assert.equal(await s.apply(true), 0);
  assert.match(s.output(), /not created \(sprint is full, no backlog set\): "Fix refund rounding"/);
  assert.deepEqual(s.op.calls, []);
  assert.deepEqual(s.links(), []);
});

test('evidence: refuses to close or create-closed without a done note and a commit, before any write', async () => {
  for (const plan of [
    [{ ...ref('t2'), action: 'close', ticket: 11 }],
    [{ ...ref('t3'), action: 'close', ticket: 10 }],
    [{ ...ref('t3'), action: 'create', subject: 'x', description: '', points: 1, closed: true }],
  ]) {
    const s = setup(plan);
    await assert.rejects(s.apply(true), /only done work with a commit can close a ticket/);
    assert.deepEqual(s.op.calls, []);
  }
});

test('stale or unknown notes, unmapped projects and duplicates are refused', async () => {
  const s = setup([closeT1]);
  appendEvent(s.home, 'tdm', DAY, noteEvent({ ts: 't9', text: 'add csv export', commit: C }));
  await assert.rejects(s.apply(), /Action 1 \(tdm\): note not found, or a newer note replaced it; run reconcile:candidates again/);
  await assert.rejects(setup([closeT1], { projects: { tdm: null } }).apply(), /Action 1 \(tdm\): not mapped to an OpenProject project; run project:map/);
  await assert.rejects(setup([closeT1, { ...closeT1, ticket: 11 }]).apply(), /Action 2 \(tdm\): same note as action 1/);
});

test('re-run after a partial failure skips what is linked and does not repeat it', async () => {
  let failComment = true;
  const op = fakeOp({
    addComment: async (id, text) => {
      if (failComment) throw new Error('POST -> 500: boom');
      op.calls.push(['comment', Number(id), text]);
      return {};
    },
  });
  const s = setup([closeT1, commentT2], { op });
  assert.equal(await s.apply(true), 1);
  assert.match(s.output(), /FAILED comment #11 "WP 11" \[In progress\] — Refund rounding: .*: POST -> 500: boom/);
  assert.deepEqual(s.removed, []);
  failComment = false;
  s.lines.length = 0;
  assert.equal(await s.apply(true), 0);
  assert.match(s.output(), /skip — Add CSV export: already linked to #10 \(closed\)/);
  assert.deepEqual(s.op.calls, [['close', 10, 12], ['comment', 11, 'Rounding fixed for refunds; receipts next.']]);
});

test('close/comment refuse a ticket from another project, before any write', async () => {
  const op = fakeOp({ getWorkPackage: async (id) => wp(Number(id), { _links: { ...wp(1)._links, project: { href: '/api/v3/projects/99', title: 'Other team' } } }) });
  const s = setup([commentT2, closeT1], { op });
  await assert.rejects(s.apply(true), /Action 1 \(tdm\): #11 belongs to Other team, not demo/);
  assert.deepEqual(op.calls, []);
});

test('a create whose close failed is closed, not re-created, on the next run', async () => {
  let failClose = true;
  const op = fakeOp({
    closeWorkPackage: async (id, statusId) => {
      if (failClose) throw new Error('PATCH -> 422: transition not allowed');
      op.calls.push(['close', Number(id), statusId]);
      return {};
    },
  });
  const s = setup([createT1], { op });
  assert.equal(await s.apply(true), 1);
  failClose = false;
  s.lines.length = 0;
  assert.equal(await s.apply(true), 0);
  assert.match(s.output(), /OK close #301 "WP 301" \[In progress\] — Add CSV export \(commit ccccccc\), created earlier/);
  assert.deepEqual(op.calls, [['create', 'Add CSV export', { typeId: 7, assigneeId: 3, versionId: 2165 }], ['close', 301, 12]]);
  assert.deepEqual(s.links().map((l) => [l.ticket, l.action]), [['301', 'created'], ['301', 'created-closed']]);
});
