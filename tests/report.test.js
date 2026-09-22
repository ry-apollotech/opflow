import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupByStatus, formatGroups } from '../src/report.js';

const wp = (id, subject, status) => ({
  id,
  subject,
  updatedAt: '2026-09-22T10:00:00Z',
  _links: { status: { href: '/api/v3/statuses/1', title: status } },
});

test('summarize keeps id, subject, status title, updatedAt', () => {
  assert.deepEqual(summarize(wp(1, 'A', 'Closed')), {
    id: 1,
    subject: 'A',
    status: 'Closed',
    updatedAt: '2026-09-22T10:00:00Z',
  });
  assert.equal(summarize({ id: 2, subject: 'B', _links: {} }).status, 'Unknown');
});

test('groupByStatus preserves first-seen order', () => {
  const items = [wp(1, 'A', 'In progress'), wp(2, 'B', 'Closed'), wp(3, 'C', 'In progress')].map(summarize);
  const groups = groupByStatus(items);
  assert.deepEqual(Object.keys(groups), ['In progress', 'Closed']);
  assert.deepEqual(groups['In progress'].map((i) => i.id), [1, 3]);
});

test('formatGroups renders a readable list', () => {
  const groups = groupByStatus([wp(1, 'A', 'Closed'), wp(2, 'B', 'New')].map(summarize));
  assert.equal(formatGroups(groups), 'Closed:\n  #1 A\n\nNew:\n  #2 B');
  assert.equal(formatGroups({}), 'No work packages updated today.');
});
