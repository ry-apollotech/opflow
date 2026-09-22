# OpenProject + Nextcloud Talk Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `dfly` CLI plus three Claude Code skills that turn a feature request into approved OpenProject User Stories, close them on approval, and post an approved end-of-day report to Nextcloud Talk.

**Architecture:** Zero-dependency Node.js ESM CLI. Pure payload/report builders, two thin HTTP clients (OpenProject API v3, Nextcloud Talk OCS) sharing one `requestJson` helper, and a `run(argv, deps)` dispatcher that is tested with fakes. Skills are Markdown templates rendered by an install script into `~/.claude/skills/` with absolute paths to the CLI.

**Tech Stack:** Node.js ≥ 18 (built-in `fetch`, `node:test`, `node:assert/strict`), ES modules, no npm dependencies.

Spec: `docs/superpowers/specs/2026-09-22-openproject-talk-workflow-design.md`

## Global Constraints

- Node.js ≥ 18; `"type": "module"`; **no runtime or dev dependencies**.
- Work package type name: `User Story`. Done status name: `Closed`. Both matched case-insensitively.
- Every created work package is assigned to the API-key owner (`/api/v3/users/me`).
- No write to OpenProject or Nextcloud without `--yes`; without it every write command is a dry run.
- OpenProject auth: Basic, user `apikey`, password = `OP_API_KEY`.
- Talk requests send header `OCS-APIRequest: true`; message limit 32,000 characters.
- Config keys: `OP_URL`, `OP_API_KEY`, `OP_PROJECT`, `NC_URL`, `NC_USER`, `NC_APP_PASSWORD`, `NC_TALK_ROOM`.
- Secrets are never logged.
- **Before Task 8:** the repo must live in a permanent folder (not a temporary session workspace), because installed skills reference its absolute path.

## File Structure

```
package.json              scripts: test, install-skills
.gitignore                .env, .dfly/, node_modules/
.env.example              all config keys, empty
bin/dfly.js               entry: loads config, wires real clients, calls run()
src/config.js             parseEnv, buildConfig, loadConfig, REQUIRED_KEYS
src/http.js               HttpError, basicAuth, requestJson, describeError
src/payloads.js           workPackageCreateBody, closeBody, todayFilters, todayRangeFilters, localDate, validateTasks
src/openproject.js        findByName, createOpenProjectClient
src/talk.js               MAX_MESSAGE, validateMessage, createTalkClient
src/report.js             summarize, groupByStatus, formatGroups
src/cli.js                USAGE, TYPE_NAME, DONE_STATUS, parseArgs, run
scripts/install.js        renderSkill + installs skills to ~/.claude/skills
skills/plan-feature/SKILL.md
skills/done-tasks/SKILL.md
skills/report-day/SKILL.md
tests/helpers.js          mockFetch
tests/*.test.js           one per src module + install
README.md                 setup + usage
```

---

### Task 1: Project scaffold and config loading

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces:
  - `REQUIRED_KEYS: string[]`
  - `parseEnv(text: string) => Record<string,string>`
  - `buildConfig(env: Record<string,string|undefined>) => { op: { url, apiKey, project }, nc: { url, user, appPassword, room } }` (throws `Error("Missing config keys: A, B")`)
  - `loadConfig(path: string, env = process.env) => same shape` (file values, overridden by env)

- [ ] **Step 1: Create scaffold files**

`package.json`:
```json
{
  "name": "dfly",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "dfly": "bin/dfly.js" },
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test",
    "install-skills": "node scripts/install.js"
  }
}
```

`.gitignore`:
```
.env
.dfly/
node_modules/
```

`.env.example`:
```
# OpenProject — API key from My account > Access tokens
OP_URL=https://openproject.example.com
OP_API_KEY=
# Project identifier (from the project URL) or numeric id
OP_PROJECT=

# Nextcloud — app password from Settings > Security > Devices & sessions
NC_URL=https://cloud.example.com
NC_USER=
NC_APP_PASSWORD=
# Talk room token: the part after /call/ in the room URL
NC_TALK_ROOM=
```

- [ ] **Step 2: Write the failing test** — `tests/config.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, buildConfig, loadConfig, REQUIRED_KEYS } from '../src/config.js';

const full = {
  OP_URL: 'https://op.example.com/',
  OP_API_KEY: 'k',
  OP_PROJECT: 'demo',
  NC_URL: 'https://nc.example.com',
  NC_USER: 'ryan',
  NC_APP_PASSWORD: 'p',
  NC_TALK_ROOM: 'abc123',
};

test('parseEnv reads key=value, skips comments and blanks, strips quotes', () => {
  const env = parseEnv('# comment\n\nOP_URL=https://x\r\nNC_USER="ryan"\nNC_APP_PASSWORD=\'a=b\'\n');
  assert.deepEqual(env, { OP_URL: 'https://x', NC_USER: 'ryan', NC_APP_PASSWORD: 'a=b' });
});

test('buildConfig lists every missing key', () => {
  assert.throws(() => buildConfig({ OP_URL: 'x' }), {
    message: `Missing config keys: ${REQUIRED_KEYS.slice(1).join(', ')}`,
  });
});

test('buildConfig trims trailing slashes and groups by service', () => {
  assert.deepEqual(buildConfig(full), {
    op: { url: 'https://op.example.com', apiKey: 'k', project: 'demo' },
    nc: { url: 'https://nc.example.com', user: 'ryan', appPassword: 'p', room: 'abc123' },
  });
});

test('loadConfig reads the file and lets env override it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dfly-'));
  const file = join(dir, '.env');
  writeFileSync(file, Object.entries(full).map(([k, v]) => `${k}=${v}`).join('\n'));
  const config = loadConfig(file, { OP_PROJECT: 'other' });
  assert.equal(config.op.project, 'other');
  assert.equal(config.nc.room, 'abc123');
});

test('loadConfig works without a file when env has everything', () => {
  assert.equal(loadConfig(join(tmpdir(), 'does-not-exist.env'), full).op.apiKey, 'k');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/config.js'`

- [ ] **Step 4: Implement** — `src/config.js`

```js
import { existsSync, readFileSync } from 'node:fs';

export const REQUIRED_KEYS = [
  'OP_URL',
  'OP_API_KEY',
  'OP_PROJECT',
  'NC_URL',
  'NC_USER',
  'NC_APP_PASSWORD',
  'NC_TALK_ROOM',
];

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const trimSlash = (url) => url.replace(/\/+$/, '');

export function buildConfig(env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing config keys: ${missing.join(', ')}`);
  return {
    op: { url: trimSlash(env.OP_URL), apiKey: env.OP_API_KEY, project: env.OP_PROJECT },
    nc: {
      url: trimSlash(env.NC_URL),
      user: env.NC_USER,
      appPassword: env.NC_APP_PASSWORD,
      room: env.NC_TALK_ROOM,
    },
  };
}

export function loadConfig(path, env = process.env) {
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  return buildConfig({ ...fromFile, ...env });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore .env.example src/config.js tests/config.test.js
git commit -m "feat: project scaffold and .env config loading"
```

---

### Task 2: Shared HTTP helper

**Files:**
- Create: `src/http.js`, `tests/helpers.js`
- Test: `tests/http.test.js`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { status: number }`
  - `basicAuth(user: string, password: string) => string` (`"Basic <base64>"`)
  - `requestJson(fetchFn, { method = 'GET', url, headers = {}, body? }) => Promise<any>` — JSON-encodes `body`, always sends `Accept: application/json`, returns parsed JSON (or `null` for empty body), throws `HttpError` with message `"<METHOD> <pathname> -> <status>: <detail>"` on non-2xx.
  - `describeError(data, text) => string`
  - `tests/helpers.js`: `mockFetch(responses: {status?: number, json?: any}[])` → fetch-compatible fn with `.calls: {url, method, headers, body}[]` (body already JSON-parsed). Throws on unexpected extra calls.

- [ ] **Step 1: Write the test helper** — `tests/helpers.js`

```js
export function mockFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${init.method} ${url}`);
    const { status = 200, json } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (json === undefined ? '' : JSON.stringify(json)),
    };
  };
  fn.calls = calls;
  return fn;
}
```

- [ ] **Step 2: Write the failing test** — `tests/http.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, basicAuth, HttpError } from '../src/http.js';
import { mockFetch } from './helpers.js';

test('basicAuth encodes user:password', () => {
  assert.equal(basicAuth('apikey', 'secret'), `Basic ${Buffer.from('apikey:secret').toString('base64')}`);
});

test('requestJson sends JSON body with headers and returns parsed data', async () => {
  const f = mockFetch([{ json: { ok: 1 } }]);
  const data = await requestJson(f, { method: 'POST', url: 'https://x.test/a', headers: { X: '1' }, body: { a: 1 } });
  assert.deepEqual(data, { ok: 1 });
  const [call] = f.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers.Accept, 'application/json');
  assert.equal(call.headers.X, '1');
  assert.deepEqual(call.body, { a: 1 });
});

test('requestJson GET sends no body and no Content-Type', async () => {
  const f = mockFetch([{ json: [] }]);
  await requestJson(f, { url: 'https://x.test/a' });
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].body, undefined);
  assert.equal(f.calls[0].headers['Content-Type'], undefined);
});

test('requestJson returns null for an empty 2xx body', async () => {
  const f = mockFetch([{ status: 204 }]);
  assert.equal(await requestJson(f, { url: 'https://x.test/a' }), null);
});

test('requestJson formats OpenProject errors', async () => {
  const f = mockFetch([
    { status: 422, json: { errorIdentifier: 'urn:openproject-org:api:v3:errors:PropertyConstraintViolation', message: "Subject can't be blank." } },
  ]);
  await assert.rejects(
    requestJson(f, { method: 'POST', url: 'https://x.test/api/v3/wp?x=1', body: {} }),
    (err) =>
      err instanceof HttpError &&
      err.status === 422 &&
      err.message === "POST /api/v3/wp -> 422: urn:openproject-org:api:v3:errors:PropertyConstraintViolation: Subject can't be blank.",
  );
});

test('requestJson formats OCS errors', async () => {
  const f = mockFetch([{ status: 404, json: { ocs: { meta: { status: 'failure', message: 'Room not found' }, data: [] } } }]);
  await assert.rejects(requestJson(f, { url: 'https://x.test/ocs/room' }), {
    message: 'GET /ocs/room -> 404: Room not found',
  });
});

test('requestJson falls back to the raw text for non-JSON errors', async () => {
  const f = async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
  await assert.rejects(requestJson(f, { url: 'https://x.test/a' }), {
    message: 'GET /a -> 502: <html>Bad gateway</html>',
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/http.js'`

- [ ] **Step 4: Implement** — `src/http.js`

```js
export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export function describeError(data, text) {
  if (data?.errorIdentifier) return `${data.errorIdentifier}: ${data.message}`;
  if (data?.ocs?.meta?.message) return data.ocs.meta.message;
  if (data?.message) return data.message;
  return (text || '').slice(0, 200) || 'no response body';
}

export async function requestJson(fetchFn, { method = 'GET', url, headers = {}, body }) {
  const hasBody = body !== undefined;
  const res = await fetchFn(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    throw new HttpError(`${method} ${new URL(url).pathname} -> ${res.status}: ${describeError(data, text)}`, res.status);
  }
  return data;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS (config + http)

- [ ] **Step 6: Commit**

```bash
git add src/http.js tests/helpers.js tests/http.test.js
git commit -m "feat: shared JSON HTTP helper with readable errors"
```

---

### Task 3: Payload builders and task validation

**Files:**
- Create: `src/payloads.js`
- Test: `tests/payloads.test.js`

**Interfaces:**
- Produces:
  - `workPackageCreateBody({ subject, description }, { typeId, assigneeId }) => object`
  - `closeBody(lockVersion: number, statusId: number) => object`
  - `todayFilters() => string` (JSON string, `updatedAt` operator `t`)
  - `todayRangeFilters(date: 'YYYY-MM-DD') => string` (JSON string, `updatedAt` operator `<>d`)
  - `localDate(d = new Date()) => 'YYYY-MM-DD'` (local time)
  - `validateTasks(value: unknown) => { subject: string, description: string }[]` (throws `Error` naming the bad item)

- [ ] **Step 1: Write the failing test** — `tests/payloads.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/payloads.js'`

- [ ] **Step 3: Implement** — `src/payloads.js`

```js
export function workPackageCreateBody({ subject, description }, { typeId, assigneeId }) {
  return {
    subject,
    description: { format: 'markdown', raw: description ?? '' },
    _links: {
      type: { href: `/api/v3/types/${typeId}` },
      assignee: { href: `/api/v3/users/${assigneeId}` },
    },
  };
}

export function closeBody(lockVersion, statusId) {
  return { lockVersion, _links: { status: { href: `/api/v3/statuses/${statusId}` } } };
}

const assignedToMe = { assignee: { operator: '=', values: ['me'] } };

export function todayFilters() {
  return JSON.stringify([assignedToMe, { updatedAt: { operator: 't', values: [] } }]);
}

export function todayRangeFilters(date) {
  return JSON.stringify([assignedToMe, { updatedAt: { operator: '<>d', values: [date, date] } }]);
}

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function validateTasks(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('tasks file must be a non-empty JSON array');
  return value.map((task, i) => {
    const label = `Task ${i + 1}`;
    const subject = typeof task?.subject === 'string' ? task.subject.trim() : '';
    if (!subject) throw new Error(`${label}: subject is required`);
    if (subject.length > 255) throw new Error(`${label}: subject is longer than 255 characters`);
    const description = task.description ?? '';
    if (typeof description !== 'string') throw new Error(`${label}: description must be a string`);
    return { subject, description };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/payloads.js tests/payloads.test.js
git commit -m "feat: OpenProject payload builders and tasks.json validation"
```

---

### Task 4: OpenProject client

**Files:**
- Create: `src/openproject.js`
- Test: `tests/openproject.test.js`

**Interfaces:**
- Consumes: `requestJson`, `basicAuth` (Task 2); `workPackageCreateBody`, `closeBody`, `todayFilters`, `todayRangeFilters` (Task 3).
- Produces:
  - `findByName(elements: {name}[], name: string, kind: string) => element` (throws `"<kind> \"<name>\" not found. Available: a, b"`)
  - `createOpenProjectClient({ url, apiKey, project }, fetchFn = fetch)` returning:
    - `me() => Promise<{ id, name }>`
    - `project() => Promise<{ id, name }>`
    - `resolveType(name) => Promise<{ id, name }>`
    - `resolveStatus(name) => Promise<{ id, name }>`
    - `createWorkPackage(task: {subject, description}, ids: {typeId, assigneeId}) => Promise<WorkPackage>`
    - `getWorkPackage(id) => Promise<WorkPackage>`
    - `closeWorkPackage(id, statusId) => Promise<WorkPackage>` (one retry on 409)
    - `listUpdatedToday(today: 'YYYY-MM-DD') => Promise<WorkPackage[]>` (falls back to range filter on 400)
  - `WorkPackage` = raw API v3 HAL object (`id`, `subject`, `lockVersion`, `updatedAt`, `_links.status.title`).

- [ ] **Step 1: Write the failing test** — `tests/openproject.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenProjectClient, findByName } from '../src/openproject.js';
import { basicAuth } from '../src/http.js';
import { todayFilters, todayRangeFilters } from '../src/payloads.js';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/openproject.js'`

- [ ] **Step 3: Implement** — `src/openproject.js`

```js
import { basicAuth, requestJson } from './http.js';
import { closeBody, todayFilters, todayRangeFilters, workPackageCreateBody } from './payloads.js';

export function findByName(elements, name, kind) {
  const hit = elements.find((el) => el.name.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`${kind} "${name}" not found. Available: ${elements.map((el) => el.name).join(', ')}`);
  return hit;
}

export function createOpenProjectClient({ url, apiKey, project }, fetchFn = fetch) {
  const headers = { Authorization: basicAuth('apikey', apiKey) };
  const call = (method, path, body) => requestJson(fetchFn, { method, url: url + path, headers, body });
  const projectPath = `/api/v3/projects/${encodeURIComponent(project)}`;
  const wpPath = (id) => `/api/v3/work_packages/${encodeURIComponent(id)}`;
  const listWorkPackages = async (filters) => {
    const res = await call('GET', `${projectPath}/work_packages?filters=${encodeURIComponent(filters)}&pageSize=100`);
    return res._embedded.elements;
  };

  return {
    me: () => call('GET', '/api/v3/users/me'),
    project: () => call('GET', projectPath),

    async resolveType(name) {
      const res = await call('GET', `${projectPath}/types`);
      return findByName(res._embedded.elements, name, 'Type');
    },

    async resolveStatus(name) {
      const res = await call('GET', '/api/v3/statuses');
      return findByName(res._embedded.elements, name, 'Status');
    },

    createWorkPackage: (task, ids) => call('POST', `${projectPath}/work_packages`, workPackageCreateBody(task, ids)),

    getWorkPackage: (id) => call('GET', wpPath(id)),

    async closeWorkPackage(id, statusId) {
      for (let attempt = 1; ; attempt++) {
        const wp = await call('GET', wpPath(id));
        try {
          return await call('PATCH', wpPath(id), closeBody(wp.lockVersion, statusId));
        } catch (err) {
          if (err.status !== 409 || attempt >= 2) throw err;
        }
      }
    },

    async listUpdatedToday(today) {
      try {
        return await listWorkPackages(todayFilters());
      } catch (err) {
        if (err.status !== 400) throw err;
        return listWorkPackages(todayRangeFilters(today));
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/openproject.js tests/openproject.test.js
git commit -m "feat: OpenProject API v3 client"
```

---

### Task 5: Nextcloud Talk client

**Files:**
- Create: `src/talk.js`
- Test: `tests/talk.test.js`

**Interfaces:**
- Consumes: `requestJson`, `basicAuth` (Task 2).
- Produces:
  - `MAX_MESSAGE = 32000`
  - `validateMessage(message: string) => string` (trimmed; throws `"Message is empty"` / `"Message is N characters; Talk allows at most 32000"`)
  - `createTalkClient({ url, user, appPassword, room }, fetchFn = fetch)` returning:
    - `roomInfo() => Promise<{ token, displayName, ... }>` (the `ocs.data` object)
    - `postMessage(message: string) => Promise<{ id, ... }>` (the `ocs.data` object)

- [ ] **Step 1: Write the failing test** — `tests/talk.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkClient, validateMessage, MAX_MESSAGE } from '../src/talk.js';
import { basicAuth } from '../src/http.js';
import { mockFetch } from './helpers.js';

const cfg = { url: 'https://nc.test', user: 'ryan', appPassword: 'app-pw', room: 'abc123' };
const ocs = (data) => ({ ocs: { meta: { status: 'ok', statuscode: 200 }, data } });

test('roomInfo calls the v4 room endpoint with OCS header and basic auth', async () => {
  const f = mockFetch([{ json: ocs({ token: 'abc123', displayName: 'Daily' }) }]);
  const room = await createTalkClient(cfg, f).roomInfo();
  assert.equal(room.displayName, 'Daily');
  assert.equal(f.calls[0].url, 'https://nc.test/ocs/v2.php/apps/spreed/api/v4/room/abc123');
  assert.equal(f.calls[0].headers['OCS-APIRequest'], 'true');
  assert.equal(f.calls[0].headers.Authorization, basicAuth('ryan', 'app-pw'));
});

test('postMessage POSTs the message to the v1 chat endpoint', async () => {
  const f = mockFetch([{ status: 201, json: ocs({ id: 42, message: 'hi' }) }]);
  const posted = await createTalkClient(cfg, f).postMessage('  hi  ');
  assert.equal(posted.id, 42);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://nc.test/ocs/v2.php/apps/spreed/api/v1/chat/abc123');
  assert.deepEqual(f.calls[0].body, { message: 'hi' });
});

test('validateMessage rejects empty and oversized messages', () => {
  assert.throws(() => validateMessage('   '), { message: 'Message is empty' });
  assert.throws(() => validateMessage('x'.repeat(MAX_MESSAGE + 1)), {
    message: `Message is ${MAX_MESSAGE + 1} characters; Talk allows at most ${MAX_MESSAGE}`,
  });
  assert.equal(validateMessage(' ok '), 'ok');
});

test('postMessage validates before calling the API', async () => {
  const f = mockFetch([]);
  await assert.rejects(createTalkClient(cfg, f).postMessage(''), { message: 'Message is empty' });
  assert.equal(f.calls.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/talk.js'`

- [ ] **Step 3: Implement** — `src/talk.js`

```js
import { basicAuth, requestJson } from './http.js';

export const MAX_MESSAGE = 32000;

export function validateMessage(message) {
  const text = message.trim();
  if (!text) throw new Error('Message is empty');
  if (text.length > MAX_MESSAGE) {
    throw new Error(`Message is ${text.length} characters; Talk allows at most ${MAX_MESSAGE}`);
  }
  return text;
}

export function createTalkClient({ url, user, appPassword, room }, fetchFn = fetch) {
  const headers = { 'OCS-APIRequest': 'true', Authorization: basicAuth(user, appPassword) };
  const base = `${url}/ocs/v2.php/apps/spreed/api`;
  const token = encodeURIComponent(room);

  return {
    async roomInfo() {
      const res = await requestJson(fetchFn, { url: `${base}/v4/room/${token}`, headers });
      return res.ocs.data;
    },

    async postMessage(message) {
      const text = validateMessage(message);
      const res = await requestJson(fetchFn, {
        method: 'POST',
        url: `${base}/v1/chat/${token}`,
        headers,
        body: { message: text },
      });
      return res.ocs.data;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/talk.js tests/talk.test.js
git commit -m "feat: Nextcloud Talk chat client"
```

---

### Task 6: Report grouping

**Files:**
- Create: `src/report.js`
- Test: `tests/report.test.js`

**Interfaces:**
- Produces:
  - `summarize(wp: WorkPackage) => { id, subject, status, updatedAt }` (`status` from `_links.status.title`, default `'Unknown'`)
  - `groupByStatus(items) => Record<string, item[]>` (insertion order of first appearance)
  - `formatGroups(groups) => string` (`"No work packages updated today."` when empty)

- [ ] **Step 1: Write the failing test** — `tests/report.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/report.js'`

- [ ] **Step 3: Implement** — `src/report.js`

```js
export function summarize(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    status: wp._links?.status?.title ?? 'Unknown',
    updatedAt: wp.updatedAt,
  };
}

export function groupByStatus(items) {
  const groups = {};
  for (const item of items) (groups[item.status] ??= []).push(item);
  return groups;
}

export function formatGroups(groups) {
  const names = Object.keys(groups);
  if (!names.length) return 'No work packages updated today.';
  return names
    .map((name) => [`${name}:`, ...groups[name].map((item) => `  #${item.id} ${item.subject}`)].join('\n'))
    .join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/report.js tests/report.test.js
git commit -m "feat: group today's work packages by status"
```

---

### Task 7: CLI dispatcher and entry point

**Files:**
- Create: `src/cli.js`, `bin/dfly.js`
- Test: `tests/cli.test.js`

**Interfaces:**
- Consumes: `workPackageCreateBody`, `validateTasks`, `localDate` (Task 3); OpenProject client methods (Task 4); `validateMessage`, Talk client methods (Task 5); `summarize`, `groupByStatus`, `formatGroups` (Task 6); `loadConfig` (Task 1).
- Produces:
  - `TYPE_NAME = 'User Story'`, `DONE_STATUS = 'Closed'`, `USAGE: string`
  - `parseArgs(argv: string[]) => { command, yes, json, file, ids }`
  - `run(argv: string[], deps: { op, talk, readFile(path) => Promise<string>, log(line: string), today: 'YYYY-MM-DD' }) => Promise<0|1>` — never throws; logs `Error: ...` and returns 1.

- [ ] **Step 1: Write the failing test** — `tests/cli.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, parseArgs, USAGE } from '../src/cli.js';

function setup({ files = {}, op: opOverrides = {}, talk: talkOverrides = {} } = {}) {
  const calls = [];
  const lines = [];
  const op = {
    me: async () => ({ id: 3, name: 'Ryan' }),
    project: async () => ({ id: 1, name: 'Demo' }),
    resolveType: async () => ({ id: 7, name: 'User Story' }),
    resolveStatus: async () => ({ id: 12, name: 'Closed' }),
    createWorkPackage: async (task, ids) => {
      calls.push(['create', task.subject, ids]);
      return { id: 100 + calls.length, subject: task.subject };
    },
    getWorkPackage: async (id) => ({ id: Number(id), subject: `WP ${id}`, _links: { status: { title: 'In progress' } } }),
    closeWorkPackage: async (id, statusId) => {
      calls.push(['close', id, statusId]);
      return { id: Number(id), subject: `WP ${id}` };
    },
    listUpdatedToday: async () => [
      { id: 1, subject: 'A', updatedAt: 't', _links: { status: { title: 'Closed' } } },
      { id: 2, subject: 'B', updatedAt: 't', _links: { status: { title: 'In progress' } } },
    ],
    ...opOverrides,
  };
  const talk = {
    roomInfo: async () => ({ displayName: 'Daily' }),
    postMessage: async (message) => {
      calls.push(['post', message]);
      return { id: 42 };
    },
    ...talkOverrides,
  };
  const deps = {
    op,
    talk,
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    log: (line) => lines.push(line),
    today: '2026-09-22',
  };
  return { deps, calls, lines, output: () => lines.join('\n') };
}

const tasksFile = { 't.json': JSON.stringify([{ subject: 'A', description: 'a' }, { subject: 'B' }]) };

test('parseArgs reads command, flags, file and ids', () => {
  assert.deepEqual(parseArgs(['op:done', '5', '6', '--yes']), { command: 'op:done', yes: true, json: false, file: null, ids: ['5', '6'] });
  assert.equal(parseArgs(['op:create', '--file', 'x.json']).file, 'x.json');
  assert.throws(() => parseArgs(['check', '--force']), { message: 'Unknown flag: --force' });
});

test('unknown or missing command prints usage and returns 1', async () => {
  const s = setup();
  assert.equal(await run([], s.deps), 1);
  assert.equal(s.output(), USAGE);
});

test('op:create without --yes prints payloads and creates nothing', async () => {
  const s = setup({ files: tasksFile });
  assert.equal(await run(['op:create', '--file', 't.json'], s.deps), 0);
  assert.equal(s.calls.length, 0);
  assert.match(s.output(), /DRY RUN: 2 User Story/);
  assert.match(s.output(), /"href": "\/api\/v3\/types\/7"/);
  assert.match(s.output(), /"href": "\/api\/v3\/users\/3"/);
});

test('op:create --yes creates each task assigned to me', async () => {
  const s = setup({ files: tasksFile });
  assert.equal(await run(['op:create', '--file', 't.json', '--yes'], s.deps), 0);
  assert.deepEqual(s.calls, [
    ['create', 'A', { typeId: 7, assigneeId: 3 }],
    ['create', 'B', { typeId: 7, assigneeId: 3 }],
  ]);
  assert.equal(s.output(), '#101 A\n#102 B');
});

test('op:create stops on failure and reports what was and was not created', async () => {
  let n = 0;
  const s = setup({
    files: { 't.json': JSON.stringify([{ subject: 'A' }, { subject: 'B' }, { subject: 'C' }]) },
    op: {
      createWorkPackage: async (task) => {
        n++;
        if (task.subject === 'B') throw new Error('boom');
        return { id: 200 + n, subject: task.subject };
      },
    },
  });
  assert.equal(await run(['op:create', '--file', 't.json', '--yes'], s.deps), 1);
  assert.equal(s.output(), '#201 A\nFAILED on "B": boom\nCreated before failure: #201\nNot created: B | C');
});

test('op:create requires --file and valid tasks', async () => {
  const s = setup({ files: { 'bad.json': '[]' } });
  assert.equal(await run(['op:create'], s.deps), 1);
  assert.equal(await run(['op:create', '--file', 'bad.json'], s.deps), 1);
  assert.equal(s.output(), 'Error: --file <path> is required\nError: tasks file must be a non-empty JSON array');
});

test('op:done without --yes only shows the work packages', async () => {
  const s = setup();
  assert.equal(await run(['op:done', '5'], s.deps), 0);
  assert.equal(s.calls.length, 0);
  assert.match(s.output(), /#5 WP 5 \[In progress\]/);
});

test('op:done --yes closes each id with the Closed status', async () => {
  const s = setup();
  assert.equal(await run(['op:done', '5', '6', '--yes'], s.deps), 0);
  assert.deepEqual(s.calls, [['close', '5', 12], ['close', '6', 12]]);
  assert.equal(s.output(), '#5 WP 5 -> Closed\n#6 WP 6 -> Closed');
});

test('op:done validates ids', async () => {
  const s = setup();
  assert.equal(await run(['op:done'], s.deps), 1);
  assert.equal(await run(['op:done', 'abc'], s.deps), 1);
  assert.equal(s.output(), 'Error: Give at least one work package id\nError: Invalid work package id(s): abc');
});

test('op:done keeps going after a failure and returns 1', async () => {
  const s = setup({
    op: {
      closeWorkPackage: async (id) => {
        if (id === '5') throw new Error('nope');
        return { id: Number(id), subject: `WP ${id}` };
      },
    },
  });
  assert.equal(await run(['op:done', '5', '6', '--yes'], s.deps), 1);
  assert.equal(s.output(), 'FAILED #5: nope\n#6 WP 6 -> Closed');
});

test('op:today prints grouped text or JSON', async () => {
  const text = setup();
  assert.equal(await run(['op:today'], text.deps), 0);
  assert.equal(text.output(), 'Closed:\n  #1 A\n\nIn progress:\n  #2 B');

  const json = setup();
  await run(['op:today', '--json'], json.deps);
  assert.deepEqual(JSON.parse(json.output()), [
    { id: 1, subject: 'A', status: 'Closed', updatedAt: 't' },
    { id: 2, subject: 'B', status: 'In progress', updatedAt: 't' },
  ]);
});

test('talk:post without --yes prints the message and posts nothing', async () => {
  const s = setup({ files: { 'r.md': '\nHello team\n' } });
  assert.equal(await run(['talk:post', '--file', 'r.md'], s.deps), 0);
  assert.equal(s.calls.length, 0);
  assert.equal(s.output(), 'DRY RUN: this message would be posted. Re-run with --yes to post.\n---\nHello team');
});

test('talk:post --yes posts the trimmed message', async () => {
  const s = setup({ files: { 'r.md': '\nHello team\n' } });
  assert.equal(await run(['talk:post', '--file', 'r.md', '--yes'], s.deps), 0);
  assert.deepEqual(s.calls, [['post', 'Hello team']]);
  assert.equal(s.output(), 'Posted to Talk (message id 42).');
});

test('talk:post rejects an empty file even in dry run', async () => {
  const s = setup({ files: { 'r.md': '  ' } });
  assert.equal(await run(['talk:post', '--file', 'r.md'], s.deps), 1);
  assert.equal(s.output(), 'Error: Message is empty');
});

test('check reports each item and returns 1 if any fail', async () => {
  const s = setup({ talk: { roomInfo: async () => { throw new Error('GET /x -> 401: Unauthorized'); } } });
  assert.equal(await run(['check'], s.deps), 1);
  assert.equal(
    s.output(),
    [
      'OK    OpenProject user: Ryan',
      'OK    OpenProject project: Demo',
      'OK    Type "User Story": id 7',
      'OK    Status "Closed": id 12',
      'FAIL  Talk room: GET /x -> 401: Unauthorized',
    ].join('\n'),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../src/cli.js'`

- [ ] **Step 3: Implement** — `src/cli.js`

```js
import { validateTasks, workPackageCreateBody } from './payloads.js';
import { formatGroups, groupByStatus, summarize } from './report.js';
import { validateMessage } from './talk.js';

export const TYPE_NAME = 'User Story';
export const DONE_STATUS = 'Closed';

export const USAGE = `Usage: dfly <command> [options]

Commands:
  check                          Verify OpenProject and Nextcloud Talk access (read-only)
  op:create --file tasks.json    Create User Stories assigned to you (dry run unless --yes)
  op:done <id...>                Set work packages to Closed (dry run unless --yes)
  op:today [--json]              List your work packages updated today
  talk:post --file report.md     Post a message to the Talk room (dry run unless --yes)`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, yes: false, json: false, file: null, ids: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--file') opts.file = rest[++i] ?? null;
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`);
    else opts.ids.push(arg);
  }
  return opts;
}

function requireFile(opts) {
  if (!opts.file) throw new Error('--file <path> is required');
  return opts.file;
}

async function check(_opts, { op, talk, log }) {
  let ok = true;
  const step = async (label, fn) => {
    try {
      log(`OK    ${label}: ${await fn()}`);
    } catch (err) {
      ok = false;
      log(`FAIL  ${label}: ${err.message}`);
    }
  };
  await step('OpenProject user', async () => (await op.me()).name);
  await step('OpenProject project', async () => (await op.project()).name);
  await step(`Type "${TYPE_NAME}"`, async () => `id ${(await op.resolveType(TYPE_NAME)).id}`);
  await step(`Status "${DONE_STATUS}"`, async () => `id ${(await op.resolveStatus(DONE_STATUS)).id}`);
  await step('Talk room', async () => (await talk.roomInfo()).displayName);
  return ok ? 0 : 1;
}

async function opCreate(opts, { op, readFile, log }) {
  const tasks = validateTasks(JSON.parse(await readFile(requireFile(opts))));
  const [me, type] = await Promise.all([op.me(), op.resolveType(TYPE_NAME)]);
  const ids = { typeId: type.id, assigneeId: me.id };

  if (!opts.yes) {
    log(`DRY RUN: ${tasks.length} ${TYPE_NAME}(s) would be created and assigned to ${me.name}. Re-run with --yes to create.`);
    log(JSON.stringify(tasks.map((task) => workPackageCreateBody(task, ids)), null, 2));
    return 0;
  }

  const created = [];
  for (const [i, task] of tasks.entries()) {
    try {
      const wp = await op.createWorkPackage(task, ids);
      created.push(wp);
      log(`#${wp.id} ${wp.subject}`);
    } catch (err) {
      log(`FAILED on "${task.subject}": ${err.message}`);
      log(`Created before failure: ${created.map((wp) => `#${wp.id}`).join(', ') || 'none'}`);
      log(`Not created: ${tasks.slice(i).map((t) => t.subject).join(' | ')}`);
      return 1;
    }
  }
  return 0;
}

async function opDone(opts, { op, log }) {
  if (!opts.ids.length) throw new Error('Give at least one work package id');
  const bad = opts.ids.filter((id) => !/^\d+$/.test(id));
  if (bad.length) throw new Error(`Invalid work package id(s): ${bad.join(', ')}`);

  if (!opts.yes) {
    log(`DRY RUN: these would be set to ${DONE_STATUS}. Re-run with --yes to apply.`);
    for (const id of opts.ids) {
      const wp = await op.getWorkPackage(id);
      log(`#${wp.id} ${wp.subject} [${wp._links?.status?.title ?? 'Unknown'}]`);
    }
    return 0;
  }

  const status = await op.resolveStatus(DONE_STATUS);
  let failed = 0;
  for (const id of opts.ids) {
    try {
      const wp = await op.closeWorkPackage(id, status.id);
      log(`#${wp.id} ${wp.subject} -> ${DONE_STATUS}`);
    } catch (err) {
      failed++;
      log(`FAILED #${id}: ${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

async function opToday(opts, { op, log, today }) {
  const items = (await op.listUpdatedToday(today)).map(summarize);
  log(opts.json ? JSON.stringify(items, null, 2) : formatGroups(groupByStatus(items)));
  return 0;
}

async function talkPost(opts, { talk, readFile, log }) {
  const message = validateMessage(await readFile(requireFile(opts)));
  if (!opts.yes) {
    log('DRY RUN: this message would be posted. Re-run with --yes to post.');
    log('---');
    log(message);
    return 0;
  }
  const posted = await talk.postMessage(message);
  log(`Posted to Talk (message id ${posted.id}).`);
  return 0;
}

const COMMANDS = {
  check,
  'op:create': opCreate,
  'op:done': opDone,
  'op:today': opToday,
  'talk:post': talkPost,
};

export async function run(argv, deps) {
  try {
    const opts = parseArgs(argv);
    const command = COMMANDS[opts.command];
    if (!command) {
      deps.log(USAGE);
      return 1;
    }
    return await command(opts, deps);
  } catch (err) {
    deps.log(`Error: ${err.message}`);
    return 1;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 5: Write the entry point** — `bin/dfly.js`

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run, USAGE } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { createOpenProjectClient } from '../src/openproject.js';
import { localDate } from '../src/payloads.js';
import { createTalkClient } from '../src/talk.js';

const argv = process.argv.slice(2);

if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
  console.log(USAGE);
} else {
  try {
    const config = loadConfig(fileURLToPath(new URL('../.env', import.meta.url)));
    process.exitCode = await run(argv, {
      op: createOpenProjectClient(config.op),
      talk: createTalkClient(config.nc),
      readFile: (path) => readFile(path, 'utf8'),
      log: (line) => console.log(line),
      today: localDate(),
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 6: Smoke-test the entry point without credentials**

Run: `node bin/dfly.js`
Expected: prints the usage text, exit 0.

Run: `node bin/dfly.js check` (with no `.env` present)
Expected: `Error: Missing config keys: OP_URL, OP_API_KEY, OP_PROJECT, NC_URL, NC_USER, NC_APP_PASSWORD, NC_TALK_ROOM`, exit 1.

- [ ] **Step 7: Commit**

```bash
git add src/cli.js bin/dfly.js tests/cli.test.js
git commit -m "feat: dfly CLI with dry-run-by-default write commands"
```

---

### Task 8: Skills, installer, and README

**Precondition:** the repo is in a permanent folder (see Global Constraints).

**Files:**
- Create: `skills/plan-feature/SKILL.md`, `skills/done-tasks/SKILL.md`, `skills/report-day/SKILL.md`, `scripts/install.js`, `README.md`
- Test: `tests/install.test.js`

**Interfaces:**
- Consumes: CLI commands from Task 7 (`op:create`, `op:done`, `op:today`, `talk:post`, all with `--yes` for writes).
- Produces:
  - `renderSkill(text: string, { dfly: string, dataDir: string }) => string`
  - `SKILLS_DIR` (repo `skills/` path)
  - Running `node scripts/install.js` writes `~/.claude/skills/<name>/SKILL.md` for each skill and creates `<repo>/.dfly/`.

- [ ] **Step 1: Write the skill templates**

`skills/plan-feature/SKILL.md`:
````markdown
---
name: plan-feature
description: Break a feature into OpenProject User Stories and create them only after the user approves. Use when the user asks to plan or build a feature and wants it tracked in OpenProject, or runs /plan-feature.
---

# Plan a feature into OpenProject

1. Understand the feature from the user's request and, if relevant, the current codebase. Ask one clarifying question only if the scope is genuinely unclear.
2. Break it into 3–10 User Stories. Each has:
   - `subject`: imperative, at most 80 characters
   - `description`: Markdown — 1–3 sentences of context, then `**Acceptance criteria**` as a `- [ ]` checklist
3. Show them as a numbered table (`# | Subject | Acceptance criteria`), then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, show the full table again, ask again.
   - **Cancel** → stop. Nothing is created.
4. Only after **Approve**, write the stories as a JSON array of `{ "subject": "...", "description": "..." }` to `{{DATA_DIR}}/tasks.json`, then run:

   ```bash
   node "{{DFLY}}" op:create --file "{{DATA_DIR}}/tasks.json" --yes
   ```
5. Show the created `#id subject` lines. If the command reports `FAILED`, tell the user which were created and which were not, and offer to retry only the missing ones (rewrite `tasks.json` with just those and ask for approval again).

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
````

`skills/done-tasks/SKILL.md`:
````markdown
---
name: done-tasks
description: Propose which of today's OpenProject User Stories are finished and set them to Closed only after the user approves. Use when work on planned tasks is completed, or the user runs /done-tasks.
---

# Close finished OpenProject tasks

1. Run:

   ```bash
   node "{{DFLY}}" op:today --json
   ```
   If the user named specific work package ids, use those instead.
2. From the work done in this conversation, decide which open (not `Closed`) items are actually finished. Only propose items whose acceptance criteria were met.
3. Show the proposal as a list (`#id subject — why it's done`), then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, run:

   ```bash
   node "{{DFLY}}" op:done <id> <id> ... --yes
   ```
5. Show the result lines. Report any `FAILED` lines verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for those exact ids in this conversation.
````

`skills/report-day/SKILL.md`:
````markdown
---
name: report-day
description: Draft an end-of-day report from today's OpenProject activity and post it to Nextcloud Talk only after the user approves. Use when the user wants to report their day, send a daily update, or runs /report-day.
---

# End-of-day report to Nextcloud Talk

1. Run:

   ```bash
   node "{{DFLY}}" op:today --json
   ```
2. Draft the report in this format (Talk renders Markdown):

   ```markdown
   **Daily report — YYYY-MM-DD**

   **Done**
   - #id Subject

   **In progress**
   - #id Subject — short note

   **Blockers**
   - None

   **Tomorrow**
   - ...
   ```
   - **Done** = status `Closed`; **In progress** = every other status.
   - Add short notes from this conversation's work where they help.
   - If blockers or tomorrow's plan are unknown, ask the user in one question before drafting.
3. Show the exact final text, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, write the text to `{{DATA_DIR}}/report.md` and run:

   ```bash
   node "{{DFLY}}" talk:post --file "{{DATA_DIR}}/report.md" --yes
   ```
5. Confirm the posted message id, or show the error verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for that exact text in this conversation.
````

- [ ] **Step 2: Write the failing test** — `tests/install.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSkill, SKILLS_DIR } from '../scripts/install.js';

test('renderSkill replaces every placeholder', () => {
  const out = renderSkill('node "{{DFLY}}" x --file "{{DATA_DIR}}/a" "{{DATA_DIR}}/b"', {
    dfly: 'C:/repo/bin/dfly.js',
    dataDir: 'C:/repo/.dfly',
  });
  assert.equal(out, 'node "C:/repo/bin/dfly.js" x --file "C:/repo/.dfly/a" "C:/repo/.dfly/b"');
});

test('every skill template has frontmatter, a --yes command, and an approval guard', () => {
  const names = readdirSync(SKILLS_DIR);
  assert.deepEqual(names.sort(), ['done-tasks', 'plan-feature', 'report-day']);
  for (const name of names) {
    const text = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), name);
    assert.match(text, /node "\{\{DFLY\}\}" .*--yes/, name);
    assert.match(text, /Never run a command with `--yes` without an explicit \*\*Approve\*\*/, name);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../scripts/install.js'`

- [ ] **Step 4: Implement** — `scripts/install.js`

```js
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SKILLS_DIR = join(ROOT, 'skills');

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

export function renderSkill(text, { dfly, dataDir }) {
  return text.replaceAll('{{DFLY}}', dfly).replaceAll('{{DATA_DIR}}', dataDir);
}

async function main() {
  const dfly = toPosix(join(ROOT, 'bin', 'dfly.js'));
  const dataDir = toPosix(join(ROOT, '.dfly'));
  const target = join(homedir(), '.claude', 'skills');
  await mkdir(dataDir, { recursive: true });

  for (const name of await readdir(SKILLS_DIR)) {
    const template = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const dir = join(target, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), renderSkill(template, { dfly, dataDir }));
    console.log(`Installed /${name} -> ${join(dir, 'SKILL.md')}`);
  }

  console.log('\nAdd this to "permissions.ask" in ~/.claude/settings.json so every write asks first:');
  console.log('  "Bash(node *dfly.js *--yes*)"');
}

if (process.argv[1] && toPosix(process.argv[1]) === toPosix(fileURLToPath(import.meta.url))) {
  await main();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: all PASS

- [ ] **Step 6: Write `README.md`**

````markdown
# dfly — OpenProject + Nextcloud Talk workflow for Claude Code

Plan a feature → approve → User Stories in OpenProject → approve → closed → approve → daily report in Nextcloud Talk.
Nothing is written without your approval.

## Setup

1. Node.js 18 or newer.
2. `cp .env.example .env` and fill it in:
   - `OP_API_KEY`: OpenProject → avatar → **My account** → **Access tokens** → API → generate.
   - `OP_PROJECT`: the project identifier from its URL (`/projects/<identifier>`).
   - `NC_APP_PASSWORD`: Nextcloud → **Settings** → **Security** → **Devices & sessions** → create app password.
   - `NC_TALK_ROOM`: open the Talk room; the token is the part after `/call/` in the URL.
3. Make sure the **User Story** type is enabled in the OpenProject project (Project settings → Work package types).
4. `node bin/dfly.js check` — every line should say `OK`.
5. `npm run install-skills` — installs `/plan-feature`, `/done-tasks`, `/report-day` into `~/.claude/skills`.
6. Add `"Bash(node *dfly.js *--yes*)"` to `permissions.ask` in `~/.claude/settings.json`.

## Daily use (in any project, in Claude Code)

- `/plan-feature add CSV export to the invoices page` — review the stories, approve, they're created and assigned to you.
- `/done-tasks` — review which stories are finished, approve, they're set to Closed.
- `/report-day` — review the report, approve, it's posted to your Talk room.

## CLI

```
node bin/dfly.js check
node bin/dfly.js op:create --file tasks.json [--yes]
node bin/dfly.js op:done <id...> [--yes]
node bin/dfly.js op:today [--json]
node bin/dfly.js talk:post --file report.md [--yes]
```

Write commands are dry runs unless `--yes` is given.

## Tests

`npm test`
````

- [ ] **Step 7: Commit**

```bash
git add skills scripts/install.js tests/install.test.js README.md
git commit -m "feat: plan-feature, done-tasks, report-day skills and installer"
```

---

### Task 9: Live setup and end-to-end verification (with the user)

This task touches real systems and user-level config; every write needs the user's explicit go-ahead.

- [ ] **Step 1: Credentials** — ask the user to create `.env` from `.env.example` themselves (do not type secrets on their behalf). Confirm it is ignored with `git check-ignore .env`.

- [ ] **Step 2: Read-only check**

Run: `node bin/dfly.js check`
Expected: five `OK` lines. If `Type "User Story"` fails, the message lists available types — the user must enable User Story in the project settings.

- [ ] **Step 3: Install skills**

Run: `npm run install-skills`
Expected: three `Installed /<name>` lines.

- [ ] **Step 4: Add the permission ask rule** — with the user's approval, add `"Bash(node *dfly.js *--yes*)"` to `permissions.ask` in `~/.claude/settings.json` (use the `update-config` skill).

- [ ] **Step 5: Dry run**

Write `.dfly/tasks.json` with `[{"subject":"dfly smoke test","description":"Created by dfly verification. Safe to delete."}]`.
Run: `node bin/dfly.js op:create --file .dfly/tasks.json`
Expected: `DRY RUN: 1 User Story(s) would be created and assigned to <name>` and the JSON payload.

- [ ] **Step 6: One real round-trip (only with user approval at each write)**
  1. `node bin/dfly.js op:create --file .dfly/tasks.json --yes` → `#<id> dfly smoke test`
  2. `node bin/dfly.js op:done <id> --yes` → `#<id> dfly smoke test -> Closed`
  3. `node bin/dfly.js op:today` → the item appears under `Closed:`
  4. Write `.dfly/report.md` with `dfly smoke test — please ignore`, then `node bin/dfly.js talk:post --file .dfly/report.md --yes` → `Posted to Talk (message id N).`
  5. Ask the user to confirm in the OpenProject and Talk UIs; they delete the test work package and message themselves if they want.

- [ ] **Step 7: Final test run**

Run: `node --test`
Expected: all PASS.

Run: `git status --short`
Expected: clean (`.env` and `.dfly/` ignored).
