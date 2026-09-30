import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workPackageCreateBody,
  closeBody,
  todayFilters,
  todayRangeFilters,
  localDate,
  validateTasks,
  allocate,
  durationToHours,
  myOpenInVersionFilters,
} from '../src/payloads.js';

test('workPackageCreateBody links type, assignee and version and sets estimated time from points', () => {
  assert.deepEqual(
    workPackageCreateBody({ subject: 'S', description: 'D', points: 4 }, { typeId: 7, assigneeId: 3, versionId: 2165 }),
    {
      subject: 'S',
      description: { format: 'markdown', raw: 'D' },
      estimatedTime: 'PT8H',
      _links: {
        type: { href: '/api/v3/types/7' },
        assignee: { href: '/api/v3/users/3' },
        version: { href: '/api/v3/versions/2165' },
      },
    },
  );
});

test('closeBody carries lockVersion and status link', () => {
  assert.deepEqual(closeBody(4, 12), {
    lockVersion: 4,
    _links: { status: { href: '/api/v3/statuses/12' } },
  });
});

test('todayFilters: assigned to me, updated today', () => {
  assert.deepEqual(JSON.parse(todayFilters()), [
    { assignee: { operator: '=', values: ['me'] } },
    { updatedAt: { operator: 't', values: [] } },
  ]);
});

test('todayRangeFilters: explicit date range fallback', () => {
  assert.deepEqual(JSON.parse(todayRangeFilters('2026-09-22')), [
    { assignee: { operator: '=', values: ['me'] } },
    { updatedAt: { operator: '<>d', values: ['2026-09-22', '2026-09-22'] } },
  ]);
});

test('localDate pads month and day', () => {
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('validateTasks trims and defaults description', () => {
  assert.deepEqual(validateTasks([{ subject: '  A  ', points: 1 }, { subject: 'B', description: 'x', points: 4 }]), [
    { subject: 'A', description: '', points: 1 },
    { subject: 'B', description: 'x', points: 4 },
  ]);
});

test('validateTasks requires points of 1, 2 or 4', () => {
  const message = 'Task 1: points must be 1, 2 or 4 (split anything bigger than a day)';
  assert.throws(() => validateTasks([{ subject: 'A' }]), { message });
  assert.throws(() => validateTasks([{ subject: 'A', points: 3 }]), { message });
  assert.throws(() => validateTasks([{ subject: 'A', points: 8 }]), { message });
  assert.throws(() => validateTasks([{ subject: 'A', points: '2' }]), { message });
});

test('allocate fills the sprint in order and sends what does not fit to the backlog', () => {
  const t = (subject, points) => ({ subject, points });
  const { sprint, backlog } = allocate([t('A', 4), t('B', 4), t('C', 2), t('D', 1)], 7);
  assert.deepEqual(sprint.map((x) => x.subject), ['A', 'C', 'D']);
  assert.deepEqual(backlog.map((x) => x.subject), ['B']);
});

test('allocate sends everything to the backlog when no points remain', () => {
  const { sprint, backlog } = allocate([{ subject: 'A', points: 1 }], 0);
  assert.deepEqual(sprint, []);
  assert.equal(backlog.length, 1);
});

test('durationToHours reads ISO 8601 durations and treats missing as 0', () => {
  assert.equal(durationToHours('PT8H'), 8);
  assert.equal(durationToHours('PT1H30M'), 1.5);
  assert.equal(durationToHours('P1DT2H'), 26);
  assert.equal(durationToHours(null), 0);
  assert.equal(durationToHours(undefined), 0);
});

test('validateTasks rejects bad input', () => {
  assert.throws(() => validateTasks({}), { message: 'tasks file must be a non-empty JSON array' });
  assert.throws(() => validateTasks([]), { message: 'tasks file must be a non-empty JSON array' });
  assert.throws(() => validateTasks([{ subject: '' }]), { message: 'Task 1: subject is required' });
  assert.throws(() => validateTasks([{ subject: 'x'.repeat(256) }]), { message: 'Task 1: subject is longer than 255 characters' });
  assert.throws(() => validateTasks([{ subject: 'ok', points: 1 }, { subject: 'b', description: 5, points: 1 }]), {
    message: 'Task 2: description must be a string',
  });
});

test('myOpenInVersionFilters: assigned to me, open, in the version', () => {
  assert.deepEqual(JSON.parse(myOpenInVersionFilters(2165)), [
    { assignee: { operator: '=', values: ['me'] } },
    { status: { operator: 'o', values: [] } },
    { version: { operator: '=', values: ['2165'] } },
  ]);
});
