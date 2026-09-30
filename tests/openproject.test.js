import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenProjectClient, currentSprint, findByName } from '../src/openproject.js';
import { basicAuth } from '../src/http.js';
import { myOpenInVersionFilters, todayFilters, todayRangeFilters } from '../src/payloads.js';
import { mockFetch } from './helpers.js';

const cfg = { url: 'https://op.test', apiKey: 'secret', project: 'demo' };
const list = (elements) => ({ _embedded: { elements } });

test('findByName is case-insensitive and lists options on miss', () => {
  const els = [{ id: 1, name: 'Task' }, { id: 7, name: 'User story' }];
  assert.equal(findByName(els, 'User Story', 'Type').id, 7);
  assert.throws(() => findByName(els, 'Epic', 'Type'), { message: 'Type "Epic" not found. Available: Task, User story' });
});

test('me() uses apikey basic auth', async () => {
  const f = mockFetch([{ json: { id: 3, name: 'Ryan' } }]);
  const me = await createOpenProjectClient(cfg, f).me();
  assert.equal(me.id, 3);
  assert.equal(f.calls[0].url, 'https://op.test/api/v3/users/me');
  assert.equal(f.calls[0].headers.Authorization, basicAuth('apikey', 'secret'));
});

test('resolveType reads the project types; resolveStatus reads global statuses', async () => {
  const f = mockFetch([
    { json: list([{ id: 7, name: 'User Story' }]) },
    { json: list([{ id: 1, name: 'New' }, { id: 12, name: 'Closed' }]) },
  ]);
  const op = createOpenProjectClient(cfg, f);
  assert.equal((await op.resolveType('User Story')).id, 7);
  assert.equal((await op.resolveStatus('closed')).id, 12);
  assert.equal(f.calls[0].url, 'https://op.test/api/v3/projects/demo/types');
  assert.equal(f.calls[1].url, 'https://op.test/api/v3/statuses');
});

test('createWorkPackage POSTs to the project with type and assignee', async () => {
  const f = mockFetch([{ status: 201, json: { id: 101, subject: 'A' } }]);
  const wp = await createOpenProjectClient(cfg, f).createWorkPackage({ subject: 'A', description: 'd' }, { typeId: 7, assigneeId: 3 });
  assert.equal(wp.id, 101);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://op.test/api/v3/projects/demo/work_packages');
  assert.equal(f.calls[0].body._links.type.href, '/api/v3/types/7');
  assert.equal(f.calls[0].body._links.assignee.href, '/api/v3/users/3');
});

test('closeWorkPackage GETs lockVersion then PATCHes status', async () => {
  const f = mockFetch([{ json: { id: 5, lockVersion: 2 } }, { json: { id: 5, subject: 'X' } }]);
  await createOpenProjectClient(cfg, f).closeWorkPackage(5, 12);
  assert.equal(f.calls[1].method, 'PATCH');
  assert.equal(f.calls[1].url, 'https://op.test/api/v3/work_packages/5');
  assert.deepEqual(f.calls[1].body, { lockVersion: 2, _links: { status: { href: '/api/v3/statuses/12' } } });
});

test('closeWorkPackage retries once on 409 with a fresh lockVersion', async () => {
  const f = mockFetch([
    { json: { id: 5, lockVersion: 1 } },
    { status: 409, json: { errorIdentifier: 'urn:openproject-org:api:v3:errors:UpdateConflict', message: 'conflict' } },
    { json: { id: 5, lockVersion: 2 } },
    { json: { id: 5, subject: 'X' } },
  ]);
  const wp = await createOpenProjectClient(cfg, f).closeWorkPackage(5, 12);
  assert.equal(wp.subject, 'X');
  assert.equal(f.calls[3].body.lockVersion, 2);
});

test('closeWorkPackage gives up after a second 409', async () => {
  const conflict = { status: 409, json: { errorIdentifier: 'urn:x:UpdateConflict', message: 'conflict' } };
  const f = mockFetch([{ json: { lockVersion: 1 } }, conflict, { json: { lockVersion: 2 } }, conflict]);
  await assert.rejects(createOpenProjectClient(cfg, f).closeWorkPackage(5, 12), (err) => err.status === 409);
});

test('listUpdatedToday uses the "today" filter on the project', async () => {
  const f = mockFetch([{ json: list([{ id: 1 }]) }]);
  const items = await createOpenProjectClient(cfg, f).listUpdatedToday('2026-09-22');
  assert.deepEqual(items, [{ id: 1 }]);
  const url = new URL(f.calls[0].url);
  assert.equal(url.pathname, '/api/v3/projects/demo/work_packages');
  assert.equal(url.searchParams.get('filters'), todayFilters());
  assert.equal(url.searchParams.get('pageSize'), '100');
});

test('listUpdatedToday falls back to a date range when "t" is rejected', async () => {
  const f = mockFetch([
    { status: 400, json: { errorIdentifier: 'urn:openproject-org:api:v3:errors:InvalidQuery', message: 'bad operator' } },
    { json: list([{ id: 2 }]) },
  ]);
  const items = await createOpenProjectClient(cfg, f).listUpdatedToday('2026-09-22');
  assert.deepEqual(items, [{ id: 2 }]);
  assert.equal(new URL(f.calls[1].url).searchParams.get('filters'), todayRangeFilters('2026-09-22'));
});

test('currentSprint picks the open "Sprint <N>" with the highest N', () => {
  const versions = [
    { id: 2167, name: 'Backlog: Android POS', status: 'open' },
    { id: 2165, name: 'Sprint 152', status: 'open' },
    { id: 2170, name: 'Sprint 153', status: 'closed' },
    { id: 2078, name: 'Sprint 151', status: 'open' },
  ];
  assert.equal(currentSprint(versions).id, 2165);
});

test('currentSprint fails clearly when no sprint is open', () => {
  assert.throws(() => currentSprint([{ id: 1, name: 'Sprint 1', status: 'closed' }]), {
    message: 'No open version named "Sprint <N>" in the project',
  });
});

test('listMyOpenInVersion refuses to undercount when results span several pages', async () => {
  const f = mockFetch([{ json: { total: 101, _embedded: { elements: [{ id: 1 }] } } }]);
  await assert.rejects(createOpenProjectClient(cfg, f).listMyOpenInVersion(2165), {
    message: 'Version 2165 has 101 of your open work packages; only 1 were read',
  });
});

test('currentSprint compares sprint numbers numerically', () => {
  const versions = [{ id: 9, name: 'Sprint 9', status: 'open' }, { id: 10, name: 'Sprint 10', status: 'open' }];
  assert.equal(currentSprint(versions).id, 10);
});

test('listVersions reads the project versions', async () => {
  const f = mockFetch([{ json: list([{ id: 2165, name: 'Sprint 152' }]) }]);
  const versions = await createOpenProjectClient(cfg, f).listVersions();
  assert.equal(versions[0].id, 2165);
  assert.equal(f.calls[0].url, 'https://op.test/api/v3/projects/demo/versions?pageSize=500');
});

test('listMyOpenInVersion filters my open work packages in that version', async () => {
  const f = mockFetch([{ json: list([{ id: 9, estimatedTime: 'PT8H' }]) }]);
  const items = await createOpenProjectClient(cfg, f).listMyOpenInVersion(2165);
  assert.deepEqual(items, [{ id: 9, estimatedTime: 'PT8H' }]);
  const url = new URL(f.calls[0].url);
  assert.equal(url.pathname, '/api/v3/projects/demo/work_packages');
  assert.equal(url.searchParams.get('filters'), myOpenInVersionFilters(2165));
});
