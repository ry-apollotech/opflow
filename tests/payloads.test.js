import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workPackageCreateBody,
  closeBody,
  todayFilters,
  todayRangeFilters,
  localDate,
  validateTasks,
} from '../src/payloads.js';

test('workPackageCreateBody links type and assignee', () => {
  assert.deepEqual(workPackageCreateBody({ subject: 'S', description: 'D' }, { typeId: 7, assigneeId: 3 }), {
    subject: 'S',
    description: { format: 'markdown', raw: 'D' },
    _links: {
      type: { href: '/api/v3/types/7' },
      assignee: { href: '/api/v3/users/3' },
    },
  });
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
  assert.deepEqual(validateTasks([{ subject: '  A  ' }, { subject: 'B', description: 'x' }]), [
    { subject: 'A', description: '' },
    { subject: 'B', description: 'x' },
  ]);
});

test('validateTasks rejects bad input', () => {
  assert.throws(() => validateTasks({}), { message: 'tasks file must be a non-empty JSON array' });
  assert.throws(() => validateTasks([]), { message: 'tasks file must be a non-empty JSON array' });
  assert.throws(() => validateTasks([{ subject: '' }]), { message: 'Task 1: subject is required' });
  assert.throws(() => validateTasks([{ subject: 'x'.repeat(256) }]), { message: 'Task 1: subject is longer than 255 characters' });
  assert.throws(() => validateTasks([{ subject: 'ok' }, { subject: 'b', description: 5 }]), {
    message: 'Task 2: description must be a string',
  });
});
