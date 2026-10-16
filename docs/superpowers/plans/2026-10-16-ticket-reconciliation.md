# Ticket Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/opflow:done-tasks` matches the day's journal (features built, bugs fixed) against OpenProject tickets and, after one approval, closes, comments on, or creates tickets — linking every action back to its journal note.

**Architecture:** Two new CLI commands. `reconcile:candidates` (read-only) gathers the day's unlinked journal items per mapped project plus candidate tickets (the note's own ticket, a text search, your open sprint/backlog tickets). Claude decides actions and writes `~/.opflow/reconcile.json`; `reconcile:apply` (dry run unless `--yes`) re-checks every action against the journal — closing needs a done note with a commit — then executes and appends a `ticket_link` event per action. `project:map` saves repo → OpenProject project choices. `planSprint` moves to `src/sprint.js` so both `op:create` and `reconcile:apply` place open tickets by points.

**Tech Stack:** Node.js ≥18, ES modules, `node:test`, no dependencies, OpenProject API v3.

**Spec:** `docs/superpowers/specs/2026-10-16-session-journal-design.md` (section 2; section 1 is built)

## Global Constraints

- No npm dependencies; Node 18 APIs only.
- Every OpenProject write is a dry run unless `--yes`; the skill runs `--yes` only after the user's explicit **Approve** for that exact list.
- Close (or create-as-Closed) only for a `done` note that has a commit. A `partial` note can only get a comment or an open ticket.
- One OpenProject client per mapped identifier, same URL and API token. The backlog version from setup applies only to the configured project (`OP_PROJECT`).
- `opProject` in `~/.opflow/projects.json`: string = mapped, `null` = undecided (listed as `unmapped`), `false` = never ticket (skipped silently).
- Created tickets: `User Story` for features; `Bug` for bugs when the project has that type, else `User Story`. Points 1/2/4 (2h/4h/8h). Closed-on-create tickets go in the current sprint and don't count toward the 60 points; open ones use the existing sprint/backlog placement.
- `ticket_link` journal event: `{ session, source: 'cli', kind: 'ticket_link', note: { ts, session }, ticket: '<id>', action, opProject }`, appended to the note's day file. `action` ∈ `closed`, `commented`, `created`, `created-closed`.
- Run `npm test` from the repo root; it must stay green after every task.
- Commit with `git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "…"`, conventional types.
- Work on branch `feat/ticket-reconciliation` from `main`.

**Deviation from the spec (decided while planning):** the spec had the skill call `op:create` (new `--project/--type/--closed` flags), `op:done --project`, and a new `op:comment`. This plan uses one `reconcile:apply --file` command instead: one dry run and one approval for the whole table, the evidence check enforced in code rather than only in the skill, and `ticket_link` events written in one place. `op:create` and `op:done` are unchanged.

## Review Focus

- **A plan file that tries to close without evidence** (partial note, or no commit) — `reconcile:apply` refuses before any write, even if Claude wrote `close` — pinned in Task 4.
- **Re-running after a partial failure** — actions that succeeded are linked and skipped; nothing is created twice — pinned in Task 4.
- **OpenProject versions without the `search` filter** (HTTP 400) — candidates still come back, just without search matches — pinned in Task 1.
- **A mapped project that is wrong or has no open sprint** — that project shows an `error`, the other projects still come back — pinned in Task 3.
- **A stale plan** (a newer note for the same item was written after `reconcile:candidates`) — the action is refused with "run reconcile:candidates again" — pinned in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `src/payloads.js` | + `searchFilters`, `commentBody` |
| `src/openproject.js` | + `TYPE_NAME`, `DONE_STATUS` (moved from cli.js), `findType`, `searchWorkPackages`, `addComment` |
| `src/journal.js` | `ticketLinks`; `collapseItems` carries link tickets and marks linked items |
| `src/project.js` | + `projectBySlug`, `setOpProject` |
| `src/journal-cli.js` | + `project:map` |
| `src/sprint.js` (new) | `SPRINT_POINTS`, `planSprint` (moved from cli.js) |
| `src/reconcile.js` (new) | `ticketSummary`, `reconcileCandidates`, `validatePlan`, `reconcileApply` |
| `src/cli.js` | imports moved code, `--date` flag, registers `reconcile:candidates` and `reconcile:apply`, `USAGE` |
| `bin/opflow.js` | `cliDeps` gains `home`, `project`, `opFor`; routes `project:map` |
| `skills/done-tasks/SKILL.md` | new reconciliation flow, old flow as fallback |
| `README.md`, `DOCUMENTATION.md`, `package.json`, `.claude-plugin/plugin.json` | docs, version 0.4.0 |

---

### Task 1: OpenProject client — search, comment, optional type

**Files:**
- Modify: `src/payloads.js`, `src/openproject.js`, `src/cli.js` (constants move)
- Test: `tests/openproject.test.js`

**Interfaces:**
- Produces:
  - `searchFilters(text: string): string` and `commentBody(text: string): { comment: { raw: string } }` in `src/payloads.js`
  - `TYPE_NAME = 'User Story'`, `DONE_STATUS = 'Closed'` exported from `src/openproject.js` (cli.js re-exports them)
  - client methods: `findType(name): Promise<object | null>`, `searchWorkPackages(text): Promise<object[]>` (all statuses, max 10; `[]` on HTTP 400), `addComment(id, text): Promise<object>`

- [ ] **Step 1: Write the failing tests**

Add to `tests/openproject.test.js` (extend the payloads import with `searchFilters`):

```js
test('searchWorkPackages uses the search filter over all statuses, 10 results', async () => {
  const f = mockFetch([{ json: list([{ id: 9, subject: 'CSV export' }]) }]);
  const found = await createOpenProjectClient(cfg, f).searchWorkPackages('csv export');
  assert.deepEqual(found.map((wp) => wp.id), [9]);
  const url = new URL(f.calls[0].url);
  assert.equal(url.pathname, '/api/v3/projects/demo/work_packages');
  assert.equal(url.searchParams.get('pageSize'), '10');
  assert.equal(url.searchParams.get('filters'), searchFilters('csv export'));
  assert.deepEqual(JSON.parse(searchFilters('csv export')), [{ search: { operator: '**', values: ['csv export'] } }]);
});

test('searchWorkPackages: a server without the search filter (400) gives no matches; other errors throw', async () => {
  const op400 = createOpenProjectClient(cfg, mockFetch([{ status: 400, json: { message: 'Filter search does not exist.' } }]));
  assert.deepEqual(await op400.searchWorkPackages('x'), []);
  const op500 = createOpenProjectClient(cfg, mockFetch([{ status: 500, json: { message: 'boom' } }]));
  await assert.rejects(op500.searchWorkPackages('x'), /500/);
});

test('addComment POSTs a Markdown comment to the activities', async () => {
  const f = mockFetch([{ status: 201, json: { id: 77 } }]);
  await createOpenProjectClient(cfg, f).addComment(5, 'Progress: export works for invoices');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://op.test/api/v3/work_packages/5/activities');
  assert.deepEqual(f.calls[0].body, { comment: { raw: 'Progress: export works for invoices' } });
});

test('findType returns the type or null', async () => {
  const f = mockFetch([{ json: list([{ id: 7, name: 'User Story' }]) }, { json: list([{ id: 7, name: 'User Story' }, { id: 8, name: 'Bug' }]) }]);
  const op = createOpenProjectClient(cfg, f);
  assert.equal(await op.findType('Bug'), null);
  assert.equal((await op.findType('bug')).id, 8);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/openproject.test.js`
Expected: FAIL — `searchFilters` is not exported (SyntaxError on import).

- [ ] **Step 3: Implement**

In `src/payloads.js`, after `myOpenInVersionFilters`:

```js
// OpenProject's full-text filter; explicit filters replace the default "open only" status filter.
export function searchFilters(text) {
  return JSON.stringify([{ search: { operator: '**', values: [text] } }]);
}

export const commentBody = (text) => ({ comment: { raw: text } });
```

In `src/openproject.js`:
- add `commentBody, searchFilters` to the payloads import;
- add at the top, after the imports:

```js
export const TYPE_NAME = 'User Story';
export const DONE_STATUS = 'Closed';
```

- change `listWorkPackages` to take a page size:

```js
  const listWorkPackages = async (filters, pageSize = 100) => {
    const res = await call('GET', `${projectPath}/work_packages?filters=${encodeURIComponent(filters)}&pageSize=${pageSize}`);
    return res._embedded.elements;
  };
```

- add these methods after `resolveStatus`:

```js
    async findType(name) {
      const res = await call('GET', `${projectPath}/types`);
      return res._embedded.elements.find((el) => el.name.toLowerCase() === name.toLowerCase()) ?? null;
    },

    // Servers without the "search" filter answer 400; that just means no search matches.
    async searchWorkPackages(text) {
      try {
        return await listWorkPackages(searchFilters(text), 10);
      } catch (err) {
        if (err.status !== 400) throw err;
        return [];
      }
    },

    addComment: (id, text) => call('POST', `${wpPath(id)}/activities`, commentBody(text)),
```

In `src/cli.js`, replace

```js
import { currentSprint, findByName } from './openproject.js';
```
with
```js
import { DONE_STATUS, TYPE_NAME, currentSprint, findByName } from './openproject.js';
```
and replace the two lines `export const TYPE_NAME = 'User Story';` / `export const DONE_STATUS = 'Closed';` with:

```js
export { DONE_STATUS, TYPE_NAME };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/openproject.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/payloads.js src/openproject.js src/cli.js tests/openproject.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: OpenProject search, comments and optional type lookup"
```

---

### Task 2: Ticket links in the journal, and `project:map`

**Files:**
- Modify: `src/journal.js`, `src/project.js`, `src/journal-cli.js`, `src/cli.js` (`USAGE`), `bin/opflow.js` (routing)
- Test: `tests/journal.test.js`, `tests/project.test.js`, `tests/journal-cli.test.js`

**Interfaces:**
- Consumes: `loadProjects`, `saveProjects` (existing).
- Produces:
  - `ticketLinks(events): Map<string, linkEvent>` keyed `"<session>|<ts>"` of the linked note
  - `collapseItems(events)` items now may have `link: { ticket, action }` (only when the item's **latest** note is linked) and `ticket` carried from any earlier linked note
  - `projectBySlug(home, slug): { root, slug, opProject } | null`
  - `setOpProject(home, slug, value: string | false): void` (throws on unknown slug)
  - CLI `project:map <slug> <identifier>` / `project:map <slug> --never`

- [ ] **Step 1: Write the failing tests**

Add to `tests/journal.test.js` (extend the import with `ticketLinks`):

```js
const link = (over) => ({ session: 's1', source: 'cli', kind: 'ticket_link', ticket: '55', action: 'commented', opProject: 'demo', ...over });

test('ticketLinks keys links by the note they belong to', () => {
  const links = ticketLinks([note({ ts: 't1' }), link({ note: { ts: 't1', session: 's1' } }), { kind: 'ticket_link' }]);
  assert.deepEqual([...links.keys()], ['s1|t1']);
});

test('collapseItems: a linked latest note is marked; a newer note keeps the ticket but is not linked', () => {
  const first = note({ ts: 't1', status: 'partial', text: 'Export' });
  const linked = collapseItems([first, link({ note: { ts: 't1', session: 's1' } })]);
  assert.deepEqual([linked[0].ticket, linked[0].link], ['55', { ticket: '55', action: 'commented' }]);
  const later = collapseItems([first, link({ note: { ts: 't1', session: 's1' } }), note({ ts: 't2', status: 'done', text: 'export' })]);
  assert.equal(later.length, 1);
  assert.deepEqual([later[0].status, later[0].ticket, later[0].link], ['done', '55', undefined]);
});
```

Add to `tests/project.test.js` (extend the import with `projectBySlug, setOpProject`):

```js
test('projectBySlug and setOpProject', () => {
  const home = tempDir();
  const repo = makeRepo('tdm');
  identifyProject(home, repo);
  assert.deepEqual(projectBySlug(home, 'tdm'), { root: toPosix(repo), slug: 'tdm', opProject: null });
  assert.equal(projectBySlug(home, 'nope'), null);
  setOpProject(home, 'tdm', 'iconnect');
  assert.equal(projectBySlug(home, 'tdm').opProject, 'iconnect');
  setOpProject(home, 'tdm', false);
  assert.equal(projectBySlug(home, 'tdm').opProject, false);
  assert.throws(() => setOpProject(home, 'nope', 'x'), /Unknown project "nope"\. Known: tdm/);
});
```

Add to `tests/journal-cli.test.js` (extend imports with `import { projectBySlug } from '../src/project.js';`):

```js
test('project:map saves a mapping or "never"; validates arguments', () => {
  const s = setup();
  s.run(NOTE);
  assert.equal(s.run(['project:map', 'tdm', 'iconnect']), 0);
  assert.equal(s.lines.at(-1), 'tdm -> OpenProject project iconnect');
  assert.equal(projectBySlug(s.home, 'tdm').opProject, 'iconnect');
  assert.equal(s.run(['project:map', 'tdm', '--never']), 0);
  assert.equal(s.lines.at(-1), 'tdm will never be ticketed.');
  assert.equal(projectBySlug(s.home, 'tdm').opProject, false);
  assert.equal(s.run(['project:map', 'tdm']), 1);
  assert.match(s.lines.at(-1), /Usage: project:map/);
  assert.equal(s.run(['project:map', 'tdm', '../x']), 1);
  assert.match(s.lines.at(-1), /Invalid OpenProject identifier/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/journal.test.js tests/project.test.js tests/journal-cli.test.js`
Expected: FAIL — `ticketLinks` / `projectBySlug` not exported.

- [ ] **Step 3: Implement**

`src/journal.js` — add above `collapseItems`:

```js
const noteRef = (e) => `${e.session}|${e.ts}`;

export function ticketLinks(events) {
  return new Map(events.filter((e) => e.kind === 'ticket_link' && e.note).map((e) => [`${e.note.session}|${e.note.ts}`, e]));
}
```

and replace `collapseItems` with:

```js
// One entry per feature/bug: the latest note wins (moved to the end), keeping an earlier commit or ticket if it has
// none. A note's ticket_link counts as its ticket; `link` is set only when the latest note itself is linked.
export function collapseItems(events) {
  const links = ticketLinks(events);
  const items = [];
  for (const e of events) {
    if (!NOTE_KINDS.includes(e.kind) || typeof e.text !== 'string') continue;
    const link = links.get(noteRef(e));
    const current = link && !e.ticket ? { ...e, ticket: link.ticket } : e;
    const index = items.findIndex((item) => sameItem(item, current));
    const before = index === -1 ? null : items.splice(index, 1)[0];
    items.push({
      ...current,
      ...(before?.commit && !current.commit ? { commit: before.commit } : {}),
      ...(before?.ticket && !current.ticket ? { ticket: before.ticket } : {}),
      ...(link ? { link: { ticket: link.ticket, action: link.action } } : {}),
    });
  }
  return items;
}
```

`src/project.js` — append:

```js
export function projectBySlug(home, slug) {
  const hit = Object.entries(loadProjects(home)).find(([, p]) => p.slug === slug);
  return hit ? { root: hit[0], ...hit[1] } : null;
}

export function setOpProject(home, slug, opProject) {
  const projects = loadProjects(home);
  const root = Object.keys(projects).find((r) => projects[r].slug === slug);
  if (!root) {
    const known = Object.values(projects).map((p) => p.slug).join(', ') || 'none';
    throw new Error(`Unknown project "${slug}". Known: ${known}`);
  }
  saveProjects(home, { ...projects, [root]: { ...projects[root], opProject } });
}
```

`src/journal-cli.js`:
- extend the project import: `import { identifyProject, runGit, setOpProject } from './project.js';`
- add before `const COMMANDS`:

```js
function projectMap(args, { home, log }) {
  const [slug, target, ...extra] = args;
  if (!slug || !target || extra.length) throw new Error('Usage: project:map <project> <openproject-identifier>|--never');
  if (target !== '--never' && !/^[a-z0-9][a-z0-9_-]*$/i.test(target)) throw new Error(`Invalid OpenProject identifier: ${target}`);
  setOpProject(home, slug, target === '--never' ? false : target);
  log(target === '--never' ? `${slug} will never be ticketed.` : `${slug} -> OpenProject project ${target}`);
  return 0;
}
```

- in `runJournal`, inside the `try`, before the `return COMMANDS…` line:

```js
    if (command === 'project:map') return projectMap(rest, deps);
```

`bin/opflow.js` — change the journal routing condition to:

```js
  if (['journal:note', 'journal:show', 'project:map'].includes(argv[0])) {
```

`src/cli.js` `USAGE` — add after the `journal:show` lines:

```
  project:map <project> <identifier>|--never
                                 Map a journal project to an OpenProject project (or never ticket it)
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/journal.test.js tests/project.test.js tests/journal-cli.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/journal.js src/project.js src/journal-cli.js src/cli.js bin/opflow.js tests/journal.test.js tests/project.test.js tests/journal-cli.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: ticket links in the journal and project:map"
```

---

### Task 3: `reconcile:candidates`

**Files:**
- Create: `src/sprint.js` (move `SPRINT_POINTS`, `planSprint` out of `src/cli.js` unchanged)
- Create: `src/reconcile.js`
- Modify: `src/cli.js` (imports, `--date`, command, `USAGE`), `bin/opflow.js` (`cliDeps`)
- Modify: `tests/cli.test.js` (parseArgs expectation)
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Consumes: `collapseItems`, `listSlugs`, `readEvents` (journal); `projectBySlug` (project); `currentSprint`, `findByName` and client methods `listVersions`, `listMyOpenInVersion`, `getWorkPackage`, `searchWorkPackages` (openproject).
- Produces:
  - `src/sprint.js`: `SPRINT_POINTS = 60`, `planSprint(tasks, { op, backlog }): Promise<{ sprint, backlog, existing, split, items: [{task, version}], skipped }>` (identical to today's)
  - `ticketSummary(wp): { id, subject, status, type, version, description }` (description ≤ 1000 chars)
  - `reconcileCandidates({ home, date, opFor, configuredProject, backlog }): Promise<{ date, configuredProject, projects: Array<{ slug, opProject, sprint?, openTickets?, items?, error? }>, unmapped: Array<{ slug, items }> }>`; each item `{ note: { ts, session }, kind, status, text, commit, ticket, matches? }`
  - CLI deps (from `cliDeps`): `home`, `project` (configured identifier), `opFor(identifier)`; `parseArgs` gains `date` (default `null`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/helpers.js` (add `import { saveProjects } from '../src/project.js';` to its imports; `mkdtempSync`, `tmpdir`, `join` are already imported there):

```js
export const wp = (id, over = {}) => ({
  id, subject: `WP ${id}`, lockVersion: 1, description: { raw: `Desc ${id}` },
  _links: { status: { title: 'In progress' }, type: { title: 'User Story' }, version: { title: 'Sprint 152' } },
  ...over,
});

export function fakeOp(over = {}) {
  const calls = [];
  const op = {
    calls,
    me: async () => ({ id: 3, name: 'Ryan' }),
    listVersions: async () => [{ id: 2165, name: 'Sprint 152', status: 'open' }, { id: 2167, name: 'Backlog: POS', status: 'open' }],
    listMyOpenInVersion: async (versionId) => (versionId === 2165 ? [wp(10)] : [wp(11)]),
    getWorkPackage: async (id) => wp(Number(id)),
    searchWorkPackages: async (text) => (text.includes('CSV') ? [wp(12), wp(10)] : []),
    resolveType: async () => ({ id: 7, name: 'User Story' }),
    findType: async (name) => (name === 'Bug' ? { id: 8, name: 'Bug' } : null),
    resolveStatus: async () => ({ id: 12, name: 'Closed' }),
    createWorkPackage: async (task, ids) => { calls.push(['create', task.subject, ids]); return { id: 300 + calls.length, subject: task.subject }; },
    closeWorkPackage: async (id, statusId) => { calls.push(['close', Number(id), statusId]); return { id: Number(id) }; },
    addComment: async (id, text) => { calls.push(['comment', Number(id), text]); return { id: 1 }; },
    ...over,
  };
  return op;
}

export function journalHome(projects) {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  saveProjects(home, Object.fromEntries(Object.entries(projects).map(([slug, opProject]) => [`/work/${slug}`, { slug, opProject }])));
  return home;
}

export const noteEvent = (over) => ({ session: 'S1', source: 'claude', kind: 'feature', status: 'done', text: 'Add CSV export', ...over });
```

Create `tests/reconcile.test.js`:

```js
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
```

In `tests/cli.test.js`, change the first `parseArgs` assertion's expected object to include `date: null`:

```js
  assert.deepEqual(parseArgs(['op:done', '5', '6', '--yes']), { command: 'op:done', yes: true, json: false, file: null, date: null, ids: ['5', '6'] });
  assert.equal(parseArgs(['reconcile:candidates', '--date', '2026-10-15']).date, '2026-10-15');
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/reconcile.test.js tests/cli.test.js`
Expected: FAIL — `Cannot find module '../src/reconcile.js'`; the parseArgs test fails on the missing `date`.

- [ ] **Step 3: Move `planSprint` to `src/sprint.js`**

Create `src/sprint.js` with the body of `planSprint` copied **unchanged** from `src/cli.js`:

```js
import { currentSprint, findByName } from './openproject.js';
import { HOURS_PER_POINT, allocate, durationToHours } from './payloads.js';

export const SPRINT_POINTS = 60;

export async function planSprint(tasks, { op, backlog: backlogName }) {
  const versions = await op.listVersions();
  const sprint = currentSprint(versions);
  const backlog = backlogName ? findByName(versions, backlogName, 'Version') : null;
  const existingHours = (await op.listMyOpenInVersion(sprint.id)).reduce((sum, wp) => sum + durationToHours(wp.estimatedTime), 0);
  // round to whole minutes first so float noise in summed durations can't add a point
  const existing = Math.ceil(Math.round(existingHours * 60) / 60 / HOURS_PER_POINT);
  const split = allocate(tasks, Math.max(0, SPRINT_POINTS - existing));
  const inSprint = new Set(split.sprint);
  return {
    sprint,
    backlog,
    existing,
    split,
    // Without a backlog, stories that don't fit are left out rather than created somewhere unexpected.
    items: tasks.map((task) => ({ task, version: inSprint.has(task) ? sprint : backlog })).filter((item) => item.version),
    skipped: backlog ? [] : split.backlog,
  };
}
```

In `src/cli.js`: delete the `planSprint` function and `export const SPRINT_POINTS = 60;`; remove `HOURS_PER_POINT, allocate, durationToHours` from the payloads import if nothing else in cli.js uses them (check with a search); add

```js
import { SPRINT_POINTS, planSprint } from './sprint.js';
```

and keep `SPRINT_POINTS` exported by adding it to the re-export line: `export { DONE_STATUS, SPRINT_POINTS, TYPE_NAME };`.

Run `npm test` → PASS except the new reconcile/parseArgs tests (the move itself changes no behaviour).

- [ ] **Step 4: Implement `src/reconcile.js` (candidates part)**

```js
import { collapseItems, listSlugs, readEvents } from './journal.js';
import { currentSprint, findByName } from './openproject.js';
import { projectBySlug } from './project.js';

const DESCRIPTION_LIMIT = 1000;

export function ticketSummary(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    status: wp._links?.status?.title ?? 'Unknown',
    type: wp._links?.type?.title ?? 'Unknown',
    version: wp._links?.version?.title ?? null,
    description: (wp.description?.raw ?? '').slice(0, DESCRIPTION_LIMIT),
  };
}

const noteItem = (item) => ({
  note: { ts: item.ts, session: item.session },
  kind: item.kind,
  status: item.status,
  text: item.text,
  commit: item.commit ?? null,
  ticket: item.ticket ?? null,
});

async function ticketIfExists(op, id) {
  try {
    return await op.getWorkPackage(id);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function projectCandidates(slug, opProject, items, { opFor, configuredProject, backlog }) {
  const op = opFor(opProject);
  const versions = await op.listVersions();
  const sprint = currentSprint(versions);
  const backlogVersion = opProject === configuredProject && backlog ? findByName(versions, backlog, 'Version') : null;
  const open = [
    ...(await op.listMyOpenInVersion(sprint.id)),
    ...(backlogVersion ? await op.listMyOpenInVersion(backlogVersion.id) : []),
  ];
  const withMatches = [];
  for (const item of items) {
    const found = [...(item.ticket ? [await ticketIfExists(op, item.ticket)] : []), ...(await op.searchWorkPackages(item.text))];
    const seen = new Set();
    const matches = found.filter((wp) => wp && !seen.has(wp.id) && seen.add(wp.id)).map(ticketSummary);
    withMatches.push({ ...noteItem(item), matches });
  }
  return { slug, opProject, sprint: { id: sprint.id, name: sprint.name }, openTickets: open.map(ticketSummary), items: withMatches };
}

// The day's unlinked journal items per project, with candidate tickets for each mapped project.
export async function reconcileCandidates({ home, date, opFor, configuredProject, backlog }) {
  const projects = [];
  const unmapped = [];
  for (const slug of listSlugs(home)) {
    const items = collapseItems(readEvents(home, slug, date).events).filter((item) => !item.link);
    if (!items.length) continue;
    const opProject = projectBySlug(home, slug)?.opProject ?? null;
    if (opProject === false) continue;
    if (opProject === null) {
      unmapped.push({ slug, items: items.map(noteItem) });
      continue;
    }
    try {
      projects.push(await projectCandidates(slug, opProject, items, { opFor, configuredProject, backlog }));
    } catch (err) {
      projects.push({ slug, opProject, error: err.message });
    }
  }
  return { date, configuredProject, projects, unmapped };
}
```

- [ ] **Step 5: Wire the command**

`src/cli.js`:
- `parseArgs`: initialise `date: null` in `opts` (place it after `file: null`), and add a branch:

```js
    else if (arg === '--date') opts.date = rest[++i] ?? null;
```

- add the import `import { reconcileCandidates } from './reconcile.js';`
- add the command:

```js
function requireDate(opts, today) {
  const date = opts.date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  return date;
}

async function reconcileCandidatesCmd(opts, { home, today, opFor, project, backlog, log }) {
  const result = await reconcileCandidates({ home, date: requireDate(opts, today), opFor, configuredProject: project, backlog });
  log(JSON.stringify(result, null, 2));
  return 0;
}
```

- register `'reconcile:candidates': reconcileCandidatesCmd` in `COMMANDS`;
- `USAGE`, after the `op:today` line:

```
  reconcile:candidates [--date YYYY-MM-DD]
                                 Today's journal items with candidate tickets, per mapped project (JSON)
```

`bin/opflow.js` `cliDeps(config)` — add these properties:

```js
    home,
    project: config.op.project,
    opFor: (project) => createOpenProjectClient({ ...config.op, project }),
```

- [ ] **Step 6: Run to verify they pass**

Run: `node --test tests/reconcile.test.js tests/cli.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sprint.js src/reconcile.js src/cli.js bin/opflow.js tests/helpers.js tests/reconcile.test.js tests/cli.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: reconcile:candidates lists journal items with candidate tickets"
```

---

### Task 4: `reconcile:apply`

**Files:**
- Modify: `src/reconcile.js`, `src/cli.js` (register, `USAGE`)
- Test: `tests/reconcile-apply.test.js`

**Interfaces:**
- Consumes: `collapseItems`, `readEvents`, `appendEvent` (journal); `projectBySlug`; `validateTasks` (payloads); `planSprint` (sprint); `TYPE_NAME`, `DONE_STATUS`, `currentSprint`; client `me`, `resolveType`, `findType`, `resolveStatus`, `listVersions`, `createWorkPackage`, `closeWorkPackage`, `addComment`; test helpers `fakeOp`, `journalHome`, `noteEvent`, `wp` from `tests/helpers.js` (added in Task 3).
- Produces:
  - `validatePlan(value): Array<action>`; action = `{ action: 'close'|'comment'|'create', project, date, note: { ts, session }, ticket?, comment?, task?: { subject, description, points }, closed?: boolean }`
  - `reconcileApply(opts: { file, yes }, deps: { home, readFile, removeFile, log, opFor, project, backlog }): Promise<number>`
  - `reconcile.json` format (array): common `project` (journal slug), `date`, `note`, `action`; close: `ticket`; comment: `ticket`, `comment`; create: `subject`, `description`, `points`, `closed`

- [ ] **Step 1: Write the failing tests**

Create `tests/reconcile-apply.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, readEvents } from '../src/journal.js';
import { reconcileApply, validatePlan } from '../src/reconcile.js';
import { fakeOp, journalHome, noteEvent } from './helpers.js';

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
    '  close #10 — Add CSV export (commit ccccccc)',
    '  comment #11 — Refund rounding: Rounding fixed for refunds; receipts next.',
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
  assert.match(s.output(), /FAILED comment #11 — Refund rounding: .*: POST -> 500: boom/);
  assert.deepEqual(s.removed, []);
  failComment = false;
  s.lines.length = 0;
  assert.equal(await s.apply(true), 0);
  assert.match(s.output(), /skip — Add CSV export: already linked to #10 \(closed\)/);
  assert.deepEqual(s.op.calls, [['close', 10, 12], ['comment', 11, 'Rounding fixed for refunds; receipts next.']]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/reconcile-apply.test.js`
Expected: FAIL — `reconcileApply` / `validatePlan` not exported.

- [ ] **Step 3: Implement**

`src/reconcile.js` — extend imports:

```js
import { appendEvent, collapseItems, listSlugs, readEvents } from './journal.js';
import { DONE_STATUS, TYPE_NAME, currentSprint, findByName } from './openproject.js';
import { validateTasks } from './payloads.js';
import { projectBySlug } from './project.js';
import { planSprint } from './sprint.js';
```

Append:

```js
const ACTIONS = ['close', 'comment', 'create'];
const NO_BACKLOG = 'not created (sprint is full, no backlog set)';

export function validatePlan(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('reconcile file must be a non-empty JSON array');
  return value.map((a, i) => {
    const label = `Action ${i + 1}`;
    if (!ACTIONS.includes(a?.action)) throw new Error(`${label}: action must be close, comment or create`);
    if (typeof a.project !== 'string' || !a.project) throw new Error(`${label}: project is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')) throw new Error(`${label}: date must be YYYY-MM-DD`);
    if (typeof a.note?.ts !== 'string' || typeof a.note?.session !== 'string') throw new Error(`${label}: note {ts, session} is required`);
    const base = { action: a.action, project: a.project, date: a.date, note: { ts: a.note.ts, session: a.note.session } };
    if (a.action === 'create') {
      let task;
      try {
        [task] = validateTasks([a]);
      } catch (err) {
        throw new Error(err.message.replace(/^Task 1/, label));
      }
      return { ...base, task, closed: a.closed === true };
    }
    if (!/^\d+$/.test(String(a.ticket ?? ''))) throw new Error(`${label}: ticket must be a work package number`);
    if (a.action === 'close') return { ...base, ticket: String(a.ticket) };
    if (typeof a.comment !== 'string' || !a.comment.trim()) throw new Error(`${label}: comment text is required`);
    return { ...base, ticket: String(a.ticket), comment: a.comment.trim() };
  });
}

const closes = (action) => action.action === 'close' || (action.action === 'create' && action.closed);

// Checks one action against the journal as it is now. Throws on anything unsafe; returns a skip for linked notes.
function prepare(home, action, index, seen) {
  const label = `Action ${index + 1} (${action.project})`;
  const key = `${action.project}|${action.date}|${action.note.session}|${action.note.ts}`;
  if (seen.has(key)) throw new Error(`${label}: same note as action ${seen.get(key) + 1}`);
  seen.set(key, index);
  const opProject = projectBySlug(home, action.project)?.opProject;
  if (typeof opProject !== 'string') throw new Error(`${label}: not mapped to an OpenProject project; run project:map`);
  const item = collapseItems(readEvents(home, action.project, action.date).events)
    .find((i) => i.ts === action.note.ts && i.session === action.note.session);
  if (!item) throw new Error(`${label}: note not found, or a newer note replaced it; run reconcile:candidates again`);
  if (item.link) return { action, item, opProject, skip: `already linked to #${item.link.ticket} (${item.link.action})` };
  if (closes(action) && !(item.status === 'done' && item.commit)) {
    throw new Error(`${label}: only done work with a commit can close a ticket ("${item.text}" is ${item.status}${item.commit ? '' : ', not committed'})`);
  }
  return { action, item, opProject };
}

async function projectContext(cache, opProject, opFor) {
  if (!cache.has(opProject)) {
    cache.set(opProject, (async () => {
      const op = opFor(opProject);
      const [me, story, bug, closed, versions] = await Promise.all([
        op.me(), op.resolveType(TYPE_NAME), op.findType('Bug'), op.resolveStatus(DONE_STATUS), op.listVersions(),
      ]);
      return { op, me, types: { feature: story, bug: bug ?? story }, closedId: closed.id, sprint: currentSprint(versions) };
    })());
  }
  return cache.get(opProject);
}

// Version for each create: closed ones go in the current sprint; open ones are placed by points like op:create.
async function placeCreates(prepared, cache, { opFor, project, backlog }) {
  const versions = new Map();
  const open = new Map();
  for (const p of prepared.filter((x) => !x.skip && x.action.action === 'create')) {
    if (p.action.closed) versions.set(p, (await projectContext(cache, p.opProject, opFor)).sprint);
    else open.set(p.opProject, [...(open.get(p.opProject) ?? []), p]);
  }
  for (const [opProject, group] of open) {
    const { op } = await projectContext(cache, opProject, opFor);
    const plan = await planSprint(group.map((p) => p.action.task), { op, backlog: opProject === project ? backlog : null });
    for (const { task, version } of plan.items) versions.set(group.find((p) => p.action.task === task), version);
  }
  return versions;
}

function describe(p, type, version) {
  const { action, item } = p;
  const evidence = item.commit ? ` (commit ${item.commit.slice(0, 7)})` : '';
  if (p.skip) return `skip — ${item.text}: ${p.skip}`;
  if (action.action === 'close') return `close #${action.ticket} — ${item.text}${evidence}`;
  if (action.action === 'comment') return `comment #${action.ticket} — ${item.text}: ${action.comment.replace(/\s+/g, ' ').slice(0, 80)}`;
  if (!version) return `${NO_BACKLOG}: "${action.task.subject}"`;
  return `create ${type.name} "${action.task.subject}" (${action.task.points} pts) -> ${version.name}${action.closed ? ', then Closed' : ''}${evidence}`;
}

async function execute(p, ctx, version, link) {
  const { action } = p;
  if (action.action === 'close') {
    await ctx.op.closeWorkPackage(action.ticket, ctx.closedId);
    return link(action.ticket, 'closed');
  }
  if (action.action === 'comment') {
    await ctx.op.addComment(action.ticket, action.comment);
    return link(action.ticket, 'commented');
  }
  const type = ctx.types[p.item.kind];
  const wp = await ctx.op.createWorkPackage(action.task, { typeId: type.id, assigneeId: ctx.me.id, versionId: version.id });
  link(wp.id, 'created');
  if (action.closed) {
    await ctx.op.closeWorkPackage(wp.id, ctx.closedId);
    link(wp.id, 'created-closed');
  }
}

export async function reconcileApply(opts, deps) {
  const { home, readFile, removeFile, log, opFor } = deps;
  if (!opts.file) throw new Error('--file <path> is required');
  const raw = await readFile(opts.file);
  const actions = validatePlan(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  const seen = new Map();
  const prepared = actions.map((action, i) => prepare(home, action, i, seen));
  const cache = new Map();
  const versions = await placeCreates(prepared, cache, deps);
  const rows = [];
  for (const p of prepared) {
    const ctx = p.skip ? null : await projectContext(cache, p.opProject, opFor);
    const type = ctx?.types[p.item.kind];
    rows.push({ p, ctx, version: versions.get(p), line: describe(p, type, versions.get(p)) });
  }

  if (!opts.yes) log('DRY RUN: nothing is changed. Re-run with --yes to apply.');
  let failed = 0;
  let group = null;
  for (const { p, ctx, version, line } of rows) {
    if (p.action.project !== group) {
      group = p.action.project;
      log(`${group} (OpenProject ${p.opProject}):`);
    }
    const runnable = !p.skip && (p.action.action !== 'create' || version);
    if (!opts.yes || !runnable) {
      log(`  ${line}`);
      continue;
    }
    const link = (ticket, action) =>
      appendEvent(home, p.action.project, p.action.date, {
        session: p.item.session, source: 'cli', kind: 'ticket_link',
        note: { ts: p.item.ts, session: p.item.session }, ticket: String(ticket), action, opProject: p.opProject,
      });
    try {
      await execute(p, ctx, version, link);
      log(`  OK ${line}`);
    } catch (err) {
      failed++;
      log(`  FAILED ${line}: ${err.message}`);
    }
  }
  if (!opts.yes) return 0;
  if (failed) return 1;
  await removeFile(opts.file);
  log(`Removed ${opts.file}.`);
  return 0;
}
```

`src/cli.js`:
- import `reconcileApply` alongside `reconcileCandidates`;
- register `'reconcile:apply': reconcileApply` in `COMMANDS`;
- `USAGE`, after the `reconcile:candidates` lines:

```
  reconcile:apply --file reconcile.json
                                 Close, comment on or create tickets for journal items (dry run unless --yes)
```

Note for the test file: the dry-run test expects lines **without** `OK`, and the `--yes` lines use `  OK …` — the test for `--yes` only checks calls/links/removal, and the re-run test matches `skip — …` and `FAILED …` substrings.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/reconcile-apply.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reconcile.js src/cli.js tests/reconcile-apply.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: reconcile:apply closes, comments on or creates tickets with evidence checks"
```

---

### Task 5: `/opflow:done-tasks` skill, docs, version

**Files:**
- Modify: `skills/done-tasks/SKILL.md`, `README.md`, `DOCUMENTATION.md`, `package.json`, `.claude-plugin/plugin.json`
- Test: `tests/plugin.test.js`

**Interfaces:**
- Consumes: CLI commands `reconcile:candidates`, `project:map`, `reconcile:apply`, `op:today`, `op:done`.

- [ ] **Step 1: Write the failing test**

Add to `tests/plugin.test.js`:

```js
test('done-tasks reconciles from the journal and keeps the old flow as a fallback', () => {
  const text = read('skills/done-tasks/SKILL.md');
  for (const cmd of ['reconcile:candidates', 'project:map', 'reconcile:apply --file ~/.opflow/reconcile.json', 'op:today --json']) {
    assert.ok(text.includes(cmd), cmd);
  }
  assert.match(text, /opflow\.js" reconcile:apply --file ~\/\.opflow\/reconcile\.json --yes/);
  assert.match(text, /Never close.*without a `commit`/);
});
```

Run: `node --test tests/plugin.test.js` → FAIL on `reconcile:candidates`.

- [ ] **Step 2: Rewrite `skills/done-tasks/SKILL.md`**

```markdown
---
name: done-tasks
description: Match today's journal (features built, bugs fixed) to OpenProject tickets and close, comment on or create them only after the user approves. Use when the user runs /opflow:done-tasks.
disable-model-invocation: true
---

# Reconcile today's work with OpenProject

1. Run (add `--date YYYY-MM-DD` if the user named a day):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:candidates
   ```
   If it says opflow is not set up, tell the user to run `/opflow:setup` and stop. If `projects` and `unmapped` are both empty, use the **fallback** at the end.
2. For each entry in `unmapped`, ask the user once with AskUserQuestion: map it to the configured project (`configuredProject`), to another OpenProject project identifier, or never ticket it. Save the answer, then run `reconcile:candidates` again:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" project:map <project> <identifier>
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" project:map <project> --never
   ```
   Show any project that has an `error` to the user and leave it out.
3. For each item, compare it with its `matches` and the project's `openTickets` (read their descriptions and acceptance criteria). A ticket matches only if it describes the same outcome, not just similar words. Choose one action:

   | Situation | Action |
   |---|---|
   | `done`, has `commit`, matching ticket whose acceptance criteria this work meets | `close` |
   | `partial`, or done but not every criterion met | `comment` with a short progress note |
   | `done`, has `commit`, no matching ticket | `create` with `"closed": true` |
   | `partial`, no matching ticket | `create` with `"closed": false` |
   | no `commit`, or several tickets could match | no action — give the reason |

   Never close, or create a Closed ticket, without a `commit`.
4. Write the actions as a JSON array to `~/.opflow/reconcile.json`. Every action has `"project"` (the journal project), `"date"` (the date used in step 1), `"note"` (copied from the item) and `"action"`, plus:
   - `close`: `"ticket"`
   - `comment`: `"ticket"`, `"comment"` (Markdown, 1–3 sentences on what was done)
   - `create`: `"subject"` (imperative, at most 80 characters), `"description"` (1–3 sentences, then `**Acceptance criteria**` as a checklist, ticked for what was done), `"points"` (`1`, `2` or `4`), `"closed"`

   Then run the dry run (it changes nothing):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:apply --file ~/.opflow/reconcile.json
   ```
   If writing the file fails or the dry run prints `Error:`, fix the file if the error says how; otherwise stop and tell the user — never run the `--yes` command.
5. Show one table — `Project | Work | Ticket | Action | Evidence` — including the no-action items with their reason, followed by the dry run lines. Ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, rewrite the file, run the dry run again, show the table again, ask again.
   - **Cancel** → stop. Nothing is changed.
6. Only after **Approve**, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" reconcile:apply --file ~/.opflow/reconcile.json --yes
   ```
7. Show the result lines. Report any `FAILED` lines verbatim; running `/opflow:done-tasks` again later retries only what wasn't done.

**Fallback (nothing in the journal):** run `node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:today --json`, decide from this conversation which open items are actually finished (acceptance criteria met), show them as `#id subject — why it's done`, ask **Approve / Edit / Cancel**, and only after **Approve** run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:done <id> <id> ... --yes
   ```

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
```

- [ ] **Step 3: Docs and version**

`package.json` and `.claude-plugin/plugin.json`: `"version": "0.4.0"`.

`README.md`:
- Replace the `/opflow:done-tasks` bullet in **Daily use** with:

```markdown
- `/opflow:done-tasks`: Claude matches today's journal (features built, bugs fixed, in every project) with your
  OpenProject tickets. It proposes, per item, to close a ticket (only for committed, finished work), add a progress
  comment, or create a ticket for work that had none. Approve, and all of it is applied; each ticket is linked back
  to the journal so nothing is done twice. The first time a repo shows up, Claude asks which OpenProject project it
  belongs to (or to never ticket it).
```

- In **APIs this uses**, add rows:

```markdown
| done | `GET /api/v3/projects/{project}/work_packages?filters=[search]` (matching tickets; skipped if your OpenProject doesn't support it) |
| done (on approve) | `POST /api/v3/work_packages/{id}/activities` (progress comment) |
```

  and change the "Used by" of the `POST /api/v3/projects/{project}/work_packages` row from `plan (on approve)` to `plan, done (on approve)`.
- In **CLI**, add:

```
node "<plugin folder>/bin/opflow.js" reconcile:candidates [--date YYYY-MM-DD]
node "<plugin folder>/bin/opflow.js" reconcile:apply --file reconcile.json [--yes]
node "<plugin folder>/bin/opflow.js" project:map <project> <identifier>|--never
```

`DOCUMENTATION.md`:
- Replace the three numbered lines under `### \`/opflow:done-tasks\`` with:

```markdown
1. Claude reads today's journal for every project (`reconcile:candidates`): the features and bugs not yet linked
   to a ticket, with candidate tickets for each (the ticket named in the note, a text search, and your open sprint
   and backlog tickets).
2. For a repo that isn't mapped yet, it asks which OpenProject project it belongs to, or to never ticket it
   (saved in `~/.opflow/projects.json`).
3. It proposes one action per item — close, comment, or create (Bug type for bugs when the project has it) — and
   shows a dry run. Closing needs finished work with a commit; the CLI refuses otherwise.
4. On **Approve**, `reconcile:apply --yes` applies them and records a `ticket_link` in the journal for each.
   If the journal is empty, it falls back to the old flow: today's work packages, closed with `op:done`.
```

- In the section 7 file list, add after `src/journal-cli.js`:

```
src/sprint.js         sprint capacity: places stories in the sprint or backlog by points
src/reconcile.js      reconcile:candidates and reconcile:apply
```

  and change `src/journal-cli.js`'s description to `journal:note, journal:show and project:map`.

- [ ] **Step 4: Run tests**

Run: `npm test` → PASS. Run `node bin/opflow.js help` and confirm `reconcile:candidates`, `reconcile:apply` and `project:map` are listed.

- [ ] **Step 5: Commit**

```bash
git add skills/done-tasks/SKILL.md tests/plugin.test.js README.md DOCUMENTATION.md package.json .claude-plugin/plugin.json
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: /opflow:done-tasks reconciles the journal with OpenProject (0.4.0)"
```

---

## After the plan: manual check against your OpenProject

Not automatable here (needs real credentials); do it before calling sub-project 2 done:

1. `/plugin update opflow`, restart Claude Code, make a small committed change in a mapped repo and let Claude note it.
2. Run `/opflow:done-tasks`. Confirm `reconcile:candidates` returns matches — if every `matches` list is empty even for an obvious ticket, your OpenProject doesn't support the `search` filter (the 400 fallback); tell me and we'll switch to the `subjectOrId` filter.
3. Approve a **comment** on a test ticket first, check it in OpenProject, then try a close.
