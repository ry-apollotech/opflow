# Session Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the features built and bugs fixed in every Claude Code session into a per-project, per-day local journal, and give each new session that project's recent journal as context.

**Architecture:** Append-only JSONL files at `~/.opflow/journal/<slug>/<YYYY-MM-DD>.jsonl`. One hook script (`scripts/journal-hook.js`) records `session_start`, `session_end` and `commit` events and prints the session context; Claude records `feature`/`bug` notes with a new local-only CLI command `journal:note`. `journal:show` renders the journal. Repo roots map to slugs in `~/.opflow/projects.json`. Sub-projects 2 (ticket reconciliation) and 3 (cross-project report) get their own plans later.

**Tech Stack:** Node.js ≥18, ES modules, `node:test`, no dependencies, `git` CLI.

**Spec:** `docs/superpowers/specs/2026-10-16-session-journal-design.md` (section 1 only)

## Global Constraints

- No npm dependencies; Node 18 APIs only (`package.json` `engines.node: ">=18"`).
- The journal never talks to OpenProject or Nextcloud and needs no `~/.opflow/.env`: `journal:*` commands and the hook work before `/opflow:setup`.
- Hooks must never fail or block a session: the hook script always exits 0 and only ever prints valid hook JSON or nothing.
- Recorded kinds are exactly: `session_start`, `session_end`, `commit` (hook) and `feature`, `bug` (Claude). Statuses exactly `done`, `partial`. No tests, files, decisions or blockers.
- Journal path: `~/.opflow/journal/<slug>/<YYYY-MM-DD>.jsonl`, local date (`localDate()` from `src/payloads.js`). Project map: `~/.opflow/projects.json`. Hook errors: `~/.opflow/journal/errors.log`.
- `~/.opflow` honours `OPFLOW_HOME` (existing `opflowHome()`).
- Paths stored in the journal and `projects.json` use forward slashes; Windows drive letters upper-case.
- `--text` max 200 characters after collapsing whitespace to single spaces.
- Session context history is capped at 20 lines.
- Run the whole suite with `npm test` (from the repo root). It must stay green after every task.
- Commit with the repo's author, since git has no global identity here:
  `git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "…"`. Conventional commit types (`feat:`, `test:`, `docs:`, `chore:`).

## Review Focus

- **Hook crashes or a broken `~/.opflow`** (unwritable, `OPFLOW_HOME` pointing at a file, garbage on stdin): the session must carry on normally, the opflow reminder still shows on startup, and the error lands in `errors.log` when possible — pinned in Task 5.
- **opflow not set up yet** (no `.env`): `journal:note` and `journal:show` still work through `bin/opflow.js` instead of printing "opflow is not set up" — pinned in Task 4.
- **Windows paths** (`C:\Users\…` from Claude vs `C:/Users/…` from git): both resolve to the same project entry, not two slugs — pinned in Task 1.
- **Note text with newlines, quotes or unicode**: stays one JSONL line and renders on one line — pinned in Tasks 2 and 4.
- **A Bash command that mentions "commit" but makes no commit** (`git log --grep commit`, `git commit` that fails): no stale HEAD is recorded as a new commit — pinned in Task 5.

---

## File structure

| File | Responsibility |
|---|---|
| `src/project.js` (new) | git root detection, slugs, `projects.json` load/save, `identifyProject` |
| `src/journal.js` (new) | journal file paths, append/read events, listing, collapsing notes, session/commit lookups |
| `src/journal-view.js` (new) | Markdown rendering for `journal:show` and the session-start context text |
| `src/journal-cli.js` (new) | `journal:note` and `journal:show` commands |
| `scripts/journal-hook.js` (new) | SessionStart / PostToolUse / SessionEnd handler |
| `src/home.js` | + `projectsFile` |
| `src/cli.js` | `USAGE` lists the journal commands |
| `bin/opflow.js` | routes `journal:*` before config loading |
| `scripts/session-reminder.js` | reminder text only (main block moves into the hook); "never run" line allows `journal:note` |
| `hooks/hooks.json` | one script for SessionStart (all sources), PostToolUse (Bash/PowerShell), SessionEnd |
| `src/setup.js` | offers `permissions.allow` rules for `journal:note` |
| `tests/helpers.js` | + `gitIn`, `makeRepo` |
| `README.md`, `DOCUMENTATION.md`, `package.json`, `.claude-plugin/plugin.json` | docs, version 0.3.0 |

---

### Task 1: Project identity

**Files:**
- Create: `src/project.js`
- Modify: `src/home.js` (add `projectsFile`)
- Modify: `tests/helpers.js` (add `gitIn`, `makeRepo`)
- Test: `tests/project.test.js`

**Interfaces:**
- Consumes: `opflowHome`-style `home` path strings.
- Produces:
  - `toPosix(path: string): string`
  - `runGit(args: string[], cwd: string): string | null` — trimmed stdout, `null` on any failure
  - `projectRoot(cwd: string, git = runGit): string`
  - `slugFor(root: string, taken: Set<string>): string`
  - `loadProjects(home: string): Record<string, { slug: string, opProject: string | null | false }>`
  - `saveProjects(home: string, projects): void`
  - `identifyProject(home: string, cwd: string, git = runGit): { root: string, slug: string, opProject: string | null | false }`
  - `projectsFile(home: string): string` in `src/home.js`
  - test helpers `gitIn(dir: string, ...args: string[]): string`, `makeRepo(name = 'repo'): string` (realpath of a repo with one empty commit)

- [ ] **Step 1: Add test helpers**

Append to `tests/helpers.js`:

```js
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function gitIn(dir, ...args) {
  const res = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

export function makeRepo(name = 'repo') {
  const dir = join(mkdtempSync(join(tmpdir(), 'opflow-git-')), name);
  mkdirSync(dir);
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'initial');
  return realpathSync(dir);
}
```

Put the new `import` lines at the top of the file, above `mockFetch`.

- [ ] **Step 2: Write the failing tests**

Create `tests/project.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectsFile } from '../src/home.js';
import { identifyProject, loadProjects, projectRoot, slugFor, toPosix } from '../src/project.js';
import { gitIn, makeRepo } from './helpers.js';

const tempDir = (prefix = 'opflow-home-') => mkdtempSync(join(tmpdir(), prefix));

test('toPosix: backslashes, trailing slashes, upper-case drive letter', () => {
  assert.equal(toPosix('c:\\Users\\Ryan\\tdm\\'), 'C:/Users/Ryan/tdm');
  assert.equal(toPosix('/home/ry/tdm/'), '/home/ry/tdm');
  assert.equal(toPosix('/'), '/');
});

test('projectRoot: a subfolder of a repo resolves to the repo root', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  assert.equal(projectRoot(join(repo, 'src', 'deep')), toPosix(repo));
});

test('projectRoot: a worktree resolves to the main repo', () => {
  const repo = makeRepo();
  const wt = join(repo, '..', 'wt');
  gitIn(repo, 'worktree', 'add', '-q', wt, '-b', 'wt');
  assert.equal(projectRoot(realpathSync(wt)), toPosix(repo));
});

test('projectRoot: outside git it is the cwd itself', () => {
  const dir = realpathSync(tempDir('opflow-plain-'));
  assert.equal(projectRoot(dir), toPosix(dir));
});

test('projectRoot: Windows paths from Claude and from git agree', () => {
  const git = (args) => (args.includes('--git-common-dir') ? 'C:/Users/Ryan/tdm/.git' : null);
  assert.equal(projectRoot('C:\\Users\\Ryan\\tdm\\src', git), 'C:/Users/Ryan/tdm');
  assert.equal(projectRoot('c:\\Users\\Ryan\\notes', () => null), 'C:/Users/Ryan/notes');
});

test('slugFor: lower-case folder name, safe characters, numbered on collision', () => {
  assert.equal(slugFor('/work/TDM', new Set()), 'tdm');
  assert.equal(slugFor('/work/tdm', new Set(['tdm'])), 'tdm-2');
  assert.equal(slugFor('/work/tdm', new Set(['tdm', 'tdm-2'])), 'tdm-3');
  assert.equal(slugFor('/work/My Repo!', new Set()), 'my-repo');
  assert.equal(slugFor('/', new Set()), 'project');
});

test('identifyProject: assigns once, saves atomically, reuses the entry', () => {
  const home = tempDir();
  const repo = makeRepo('tdm');
  const first = identifyProject(home, repo);
  assert.deepEqual(first, { root: toPosix(repo), slug: 'tdm', opProject: null });
  assert.deepEqual(identifyProject(home, join(repo, '.')), first);
  assert.deepEqual(loadProjects(home), { [toPosix(repo)]: { slug: 'tdm', opProject: null } });
  assert.deepEqual(readdirSync(home).filter((f) => f.endsWith('.tmp')), []);
});

test('identifyProject: two repos with the same folder name get different slugs', () => {
  const home = tempDir();
  const a = identifyProject(home, makeRepo('tdm'));
  const b = identifyProject(home, makeRepo('tdm'));
  assert.equal(a.slug, 'tdm');
  assert.equal(b.slug, 'tdm-2');
});

test('identifyProject: backslash cwd and forward-slash git root share one entry', () => {
  const home = tempDir();
  const git = (args) => (args.includes('--git-common-dir') ? 'C:/Users/Ryan/tdm/.git' : null);
  const a = identifyProject(home, 'C:\\Users\\Ryan\\tdm', git);
  const b = identifyProject(home, 'C:/Users/Ryan/tdm/app', git);
  assert.equal(a.slug, b.slug);
  assert.equal(Object.keys(loadProjects(home)).length, 1);
});

test('loadProjects: missing file is empty; a corrupt file is a clear error', () => {
  const home = tempDir();
  assert.deepEqual(loadProjects(home), {});
  writeFileSync(projectsFile(home), '{ nope');
  assert.throws(() => loadProjects(home), /projects\.json/);
  assert.ok(existsSync(projectsFile(home)));
  assert.equal(readFileSync(projectsFile(home), 'utf8'), '{ nope');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/project.test.js`
Expected: FAIL — `Cannot find module '../src/project.js'` (and `projectsFile` not exported).

- [ ] **Step 4: Implement**

In `src/home.js`, after `reportTemplateFile`:

```js
export const projectsFile = (home) => join(home, 'projects.json');
```

Create `src/project.js`:

```js
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { projectsFile } from './home.js';

// Forward slashes, no trailing slash, upper-case drive letter: Claude and git spell Windows paths differently.
export function toPosix(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/(?<=.)\/+$/, '')
    .replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
}

export function runGit(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return res.status === 0 ? res.stdout.trim() : null;
}

// The main repo's root, also from inside a worktree; the cwd itself outside git.
export function projectRoot(cwd, git = runGit) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (common && toPosix(common).endsWith('/.git')) return toPosix(common).slice(0, -'/.git'.length);
  return toPosix(git(['rev-parse', '--show-toplevel'], cwd) ?? cwd);
}

export function slugFor(root, taken) {
  const name = root.split('/').filter(Boolean).pop() ?? '';
  const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'project';
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function loadProjects(home) {
  try {
    return JSON.parse(readFileSync(projectsFile(home), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Can't read ${projectsFile(home)}: ${err.message}`);
  }
}

export function saveProjects(home, projects) {
  mkdirSync(home, { recursive: true });
  const file = projectsFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(projects, null, 2)}\n`);
  renameSync(tmp, file);
}

export function identifyProject(home, cwd, git = runGit) {
  const root = projectRoot(cwd, git);
  const projects = loadProjects(home);
  if (projects[root]) return { root, ...projects[root] };
  const entry = { slug: slugFor(root, new Set(Object.values(projects).map((p) => p.slug))), opProject: null };
  saveProjects(home, { ...projects, [root]: entry });
  return { root, ...entry };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/project.test.js` → all PASS. Then `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/project.js src/home.js tests/helpers.js tests/project.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: identify projects by git root for the session journal"
```

---

### Task 2: Journal store

**Files:**
- Create: `src/journal.js`
- Test: `tests/journal.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (all synchronous):
  - `NOTE_KINDS = ['feature', 'bug']`
  - `journalDir(home): string`, `journalFile(home, slug, date): string`
  - `appendEvent(home, slug, date, event: object): void` — adds `ts` (ISO) unless given
  - `readEvents(home, slug, date): { events: object[], skipped: number }`
  - `listDates(home, slug): string[]` (ascending), `listSlugs(home): string[]` (ascending)
  - `collapseItems(events): Array<{ kind, status, text, ticket?, commit?, session, source, ts }>`
  - `latestSession(events): string | null`
  - `unlinkedCommit(events, session): string | null`
  - `knownHead(events, session): string | null`
  - `sessionsWithoutEnd(events, current: string): string[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/journal.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/journal.test.js`
Expected: FAIL — `Cannot find module '../src/journal.js'`.

- [ ] **Step 3: Implement**

Create `src/journal.js`:

```js
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const NOTE_KINDS = ['feature', 'bug'];
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export const journalDir = (home) => join(home, 'journal');
export const journalFile = (home, slug, date) => join(journalDir(home), slug, `${date}.jsonl`);

// One appendFileSync per event: concurrent sessions append whole lines, and a crash can't damage earlier ones.
export function appendEvent(home, slug, date, event) {
  mkdirSync(join(journalDir(home), slug), { recursive: true });
  appendFileSync(journalFile(home, slug, date), `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

export function readEvents(home, slug, date) {
  let raw;
  try {
    raw = readFileSync(journalFile(home, slug, date), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], skipped: 0 };
    throw err;
  }
  const events = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === 'object' && typeof event.kind === 'string') events.push(event);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export const listDates = (home, slug) =>
  listDir(join(journalDir(home), slug)).map((f) => DATE_FILE.exec(f.name)?.[1]).filter(Boolean).sort();

export const listSlugs = (home) =>
  listDir(journalDir(home)).filter((f) => f.isDirectory()).map((f) => f.name).sort();

const itemKey = (e) => (e.ticket ? `ticket:${e.ticket}` : `${e.kind}:${e.text.replace(/\s+/g, ' ').trim().toLowerCase()}`);

// One entry per feature/bug: the latest note wins (moved to the end), keeping an earlier commit if it has none.
export function collapseItems(events) {
  const items = new Map();
  for (const e of events) {
    if (!NOTE_KINDS.includes(e.kind) || typeof e.text !== 'string') continue;
    const key = itemKey(e);
    const before = items.get(key);
    items.delete(key);
    items.set(key, before?.commit && !e.commit ? { ...e, commit: before.commit } : e);
  }
  return [...items.values()];
}

export const latestSession = (events) => events.filter((e) => e.kind === 'session_start').at(-1)?.session ?? null;

// The session's newest commit that no note links yet.
export function unlinkedCommit(events, session) {
  const linked = new Set(events.filter((e) => NOTE_KINDS.includes(e.kind) && e.commit).map((e) => e.commit));
  return events.filter((e) => e.kind === 'commit' && e.session === session && !linked.has(e.hash)).at(-1)?.hash ?? null;
}

// The HEAD this session last saw: its latest commit, or the HEAD at session start.
export function knownHead(events, session) {
  return (
    events
      .filter((e) => e.session === session)
      .map((e) => (e.kind === 'commit' ? e.hash : e.kind === 'session_start' ? e.head : undefined))
      .filter(Boolean)
      .at(-1) ?? null
  );
}

export function sessionsWithoutEnd(events, current) {
  const open = new Map();
  for (const e of events) {
    if (e.kind === 'session_start') open.set(e.session, true);
    else if (e.kind === 'session_end') open.set(e.session, false);
  }
  return [...open].filter(([session, isOpen]) => isOpen && session !== current).map(([session]) => session);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/journal.test.js` → all PASS. Then `npm test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/journal.js tests/journal.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: append-only per-project journal store"
```

---

### Task 3: Journal views

**Files:**
- Create: `src/journal-view.js`
- Test: `tests/journal-view.test.js`

**Interfaces:**
- Consumes: collapsed items from `collapseItems` (Task 2): `{ kind, status, text, ticket?, commit? }`.
- Produces:
  - `CONTEXT_LIMIT = 20`
  - `itemLine(item): string` — `- <text> [<status>] (commit <7 chars> | not committed)[ #<ticket>]`
  - `renderDay(slug: string, items): string`
  - `sessionContext({ slug, session, todayItems, previous: { date, items } | null, otherOpen: number, cli: string }): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/journal-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_LIMIT, itemLine, renderDay, sessionContext } from '../src/journal-view.js';

const item = (over) => ({ kind: 'feature', status: 'done', text: 'Add CSV export', ...over });
const CLI = 'node "/p/bin/opflow.js"';
const base = { slug: 'tdm', session: 'abc', todayItems: [], previous: null, otherOpen: 0, cli: CLI };

test('itemLine shows status, commit evidence and ticket', () => {
  assert.equal(itemLine(item({ commit: '0123456789abcdef', ticket: '123' })), '- Add CSV export [done] (commit 0123456) #123');
  assert.equal(itemLine(item({ status: 'partial' })), '- Add CSV export [partial] (not committed)');
});

test('renderDay: Features then Bugs fixed, empty sections left out', () => {
  assert.equal(
    renderDay('tdm', [item({ kind: 'bug', text: 'Fix rounding', commit: 'aaaaaaa1' }), item({ commit: 'bbbbbbb2' })]),
    '## tdm\n\n**Features**\n- Add CSV export [done] (commit bbbbbbb)\n\n**Bugs fixed**\n- Fix rounding [done] (commit aaaaaaa)',
  );
  assert.equal(renderDay('tdm', [item({ kind: 'bug', text: 'B' })]), '## tdm\n\n**Bugs fixed**\n- B [done] (not committed)');
});

test('sessionContext: always explains how to note, with the session id', () => {
  const text = sessionContext(base);
  assert.match(text, /opflow journal — project "tdm", session abc\./);
  assert.ok(text.includes(`${CLI} journal:note --session abc --kind feature|bug --status done|partial --text "<one line>" [--ticket <id>]`));
  assert.doesNotMatch(text, /Recorded today|Unfinished/);
});

test('sessionContext: today, unfinished items from the previous day, sessions without an end', () => {
  const text = sessionContext({
    ...base,
    todayItems: [item({ commit: 'c0ffee00' })],
    previous: { date: '2026-10-15', items: [item({ text: 'Done earlier', commit: 'x' }), item({ kind: 'bug', status: 'partial', text: 'Refund rounding' })] },
    otherOpen: 1,
  });
  assert.match(text, /Recorded today:\n- Add CSV export \[done\] \(commit c0ffee0\)/);
  assert.match(text, /Unfinished from 2026-10-15:\n- Refund rounding \[partial\] \(not committed\)/);
  assert.doesNotMatch(text, /Done earlier/);
  assert.match(text, /1 other session\(s\) today have no recorded end/);
});

test('sessionContext: history is capped and points to journal:show', () => {
  const many = Array.from({ length: 30 }, (_, i) => item({ text: `Item ${i}` }));
  const lines = sessionContext({ ...base, todayItems: many }).split('\n');
  const history = lines.slice(1, lines.findIndex((l) => l.startsWith('When you finish')));
  assert.equal(history.length, CONTEXT_LIMIT);
  assert.match(history.at(-1), /more lines: node "\/p\/bin\/opflow\.js" journal:show --project tdm$/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/journal-view.test.js`
Expected: FAIL — `Cannot find module '../src/journal-view.js'`.

- [ ] **Step 3: Implement**

Create `src/journal-view.js`:

```js
export const CONTEXT_LIMIT = 20;
const SECTIONS = [['feature', 'Features'], ['bug', 'Bugs fixed']];

export function itemLine({ text, status, commit, ticket }) {
  const evidence = commit ? `commit ${commit.slice(0, 7)}` : 'not committed';
  return `- ${text} [${status}] (${evidence})${ticket ? ` #${ticket}` : ''}`;
}

export function renderDay(slug, items) {
  const lines = [`## ${slug}`];
  for (const [kind, title] of SECTIONS) {
    const list = items.filter((i) => i.kind === kind);
    if (list.length) lines.push('', `**${title}**`, ...list.map(itemLine));
  }
  return lines.join('\n');
}

export function sessionContext({ slug, session, todayItems, previous, otherOpen, cli }) {
  const history = [];
  if (todayItems.length) history.push('Recorded today:', ...todayItems.map(itemLine));
  const unfinished = previous?.items.filter((i) => i.status === 'partial') ?? [];
  if (unfinished.length) history.push(`Unfinished from ${previous.date}:`, ...unfinished.map(itemLine));
  if (otherOpen) history.push(`${otherOpen} other session(s) today have no recorded end (still open, or ended unexpectedly).`);
  const shown =
    history.length > CONTEXT_LIMIT
      ? [...history.slice(0, CONTEXT_LIMIT - 1), `… ${history.length - CONTEXT_LIMIT + 1} more lines: ${cli} journal:show --project ${slug}`]
      : history;
  return [
    `opflow journal — project "${slug}", session ${session}.`,
    ...shown,
    'When you finish or partly build a feature, or fix a bug, record it once (local journal only; no approval needed):',
    `${cli} journal:note --session ${session} --kind feature|bug --status done|partial --text "<one line>" [--ticket <id>]`,
    'Commit first when you can: the newest commit of this session that no note uses yet is attached automatically. If you note before committing, note the same item again after the commit.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/journal-view.test.js` → all PASS. Then `npm test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/journal-view.js tests/journal-view.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: journal rendering and session-start context"
```

---

### Task 4: `journal:note` and `journal:show`

**Files:**
- Create: `src/journal-cli.js`
- Modify: `bin/opflow.js` (route `journal:*` before `loadUserConfig`)
- Modify: `src/cli.js` (`USAGE`)
- Test: `tests/journal-cli.test.js`

**Interfaces:**
- Consumes: `identifyProject`, `runGit` (Task 1); `appendEvent`, `readEvents`, `listSlugs`, `collapseItems`, `latestSession`, `unlinkedCommit`, `NOTE_KINDS` (Task 2); `renderDay` (Task 3).
- Produces:
  - `parseFlags(argv: string[]): Record<string, string | true>`
  - `runJournal(argv: string[], deps: { home, cwd, today, log, git? }): number` (synchronous; exit code)
  - `journal:show --json` prints `{ date, projects: [{ slug, items, skipped }] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/journal-cli.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/journal-cli.test.js`
Expected: FAIL — `Cannot find module '../src/journal-cli.js'`.

- [ ] **Step 3: Implement `src/journal-cli.js`**

```js
import { NOTE_KINDS, appendEvent, collapseItems, latestSession, listSlugs, readEvents, unlinkedCommit } from './journal.js';
import { renderDay } from './journal-view.js';
import { identifyProject, runGit } from './project.js';

const STATUSES = ['done', 'partial'];
const MAX_TEXT = 200;

export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'json') {
      flags.json = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    flags[name] = value;
  }
  return flags;
}

function allowOnly(flags, known) {
  const unknown = Object.keys(flags).find((k) => !known.includes(k));
  if (unknown) throw new Error(`Unknown flag: --${unknown}`);
}

function noteFields(flags) {
  allowOnly(flags, ['kind', 'status', 'text', 'ticket', 'commit', 'session']);
  if (!NOTE_KINDS.includes(flags.kind)) throw new Error('--kind must be feature or bug');
  if (!STATUSES.includes(flags.status)) throw new Error('--status must be done or partial');
  const text = String(flags.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('--text is required');
  if (text.length > MAX_TEXT) throw new Error(`--text is longer than ${MAX_TEXT} characters`);
  if (flags.ticket !== undefined && !/^\d+$/.test(flags.ticket)) throw new Error('--ticket must be a work package number');
  if (flags.commit !== undefined && !/^[0-9a-f]{4,40}$/i.test(flags.commit)) throw new Error('--commit must be a commit hash');
  return { kind: flags.kind, status: flags.status, text, ...(flags.ticket ? { ticket: flags.ticket } : {}) };
}

function journalNote(flags, { home, cwd, today, log, git }) {
  const fields = noteFields(flags);
  const project = identifyProject(home, cwd, git);
  const { events } = readEvents(home, project.slug, today);
  const session = flags.session ?? latestSession(events) ?? 'unknown';
  let commit = unlinkedCommit(events, session);
  if (flags.commit !== undefined) {
    commit = git(['rev-parse', '--verify', '--quiet', `${flags.commit}^{commit}`], project.root);
    if (!commit) throw new Error(`Commit ${flags.commit} not found in ${project.root}`);
  }
  appendEvent(home, project.slug, today, { session, source: 'claude', ...fields, ...(commit ? { commit } : {}) });
  log(`Noted in ${project.slug}: ${fields.text} [${fields.status}] (${commit ? `commit ${commit.slice(0, 7)}` : 'not committed'})`);
  return 0;
}

function journalShow(flags, { home, today, log }) {
  allowOnly(flags, ['project', 'date', 'json']);
  const date = flags.date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  if (flags.project !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(flags.project)) throw new Error(`Invalid project: ${flags.project}`);
  const projects = (flags.project ? [flags.project] : listSlugs(home))
    .map((slug) => {
      const { events, skipped } = readEvents(home, slug, date);
      return { slug, items: collapseItems(events), skipped };
    })
    .filter((p) => p.items.length || p.skipped);
  if (flags.json) {
    log(JSON.stringify({ date, projects }, null, 2));
    return 0;
  }
  if (!projects.length) {
    log(`Nothing recorded for ${date}.`);
    return 0;
  }
  log(`# Journal — ${date}`);
  for (const p of projects) {
    log('');
    log(renderDay(p.slug, p.items));
    if (p.skipped) log(`(${p.skipped} unreadable line(s) skipped)`);
  }
  return 0;
}

const COMMANDS = { 'journal:note': journalNote, 'journal:show': journalShow };

export function runJournal(argv, deps) {
  const [command, ...rest] = argv;
  try {
    return COMMANDS[command](parseFlags(rest), { git: runGit, ...deps });
  } catch (err) {
    deps.log(`Error: ${err.message}`);
    return 1;
  }
}
```

- [ ] **Step 4: Route in `bin/opflow.js` and update `USAGE`**

In `bin/opflow.js`, add imports:

```js
import { runJournal } from '../src/journal-cli.js';
```

In `main()`, directly after the `setup` line:

```js
  if (argv[0] === 'journal:note' || argv[0] === 'journal:show') {
    return runJournal(argv, { home, cwd: process.cwd(), today: localDate(), log: (line) => console.log(line) });
  }
```

In `src/cli.js`, add two lines to the end of the `Commands:` list in `USAGE`:

```
  journal:note --kind feature|bug --status done|partial --text "..." [--ticket <id>] [--commit <hash>] [--session <id>]
                                 Record a feature or bug fix in this project's journal (local only)
  journal:show [--project <slug>] [--date YYYY-MM-DD] [--json]
                                 Show the journal (default: all projects, today)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/journal-cli.test.js` → all PASS. Then `npm test` → all PASS (`tests/cli.test.js` compares against the exported `USAGE`, so it follows the change).

- [ ] **Step 6: Commit**

```bash
git add src/journal-cli.js src/cli.js bin/opflow.js tests/journal-cli.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: journal:note and journal:show commands"
```

---

### Task 5: Journal hook

**Files:**
- Create: `scripts/journal-hook.js`
- Modify: `scripts/session-reminder.js` (drop `reminderOutput` and the main block; update the "never run" sentence)
- Modify: `hooks/hooks.json`
- Modify: `tests/session-reminder.test.js`, `tests/plugin.test.js`
- Test: `tests/journal-hook.test.js`

**Interfaces:**
- Consumes: `identifyProject`, `runGit`, `toPosix` (Task 1); `appendEvent`, `readEvents`, `listDates`, `collapseItems`, `knownHead`, `sessionsWithoutEnd`, `journalDir` (Task 2); `sessionContext` (Task 3); `reminderText` (existing); `localDate` (existing).
- Produces:
  - `handleHook(input: object, deps: { home, today, configured: boolean, pluginRoot: string, git? }): string` — stdout for the hook (`''` = print nothing)
  - `COMMIT_COMMAND: RegExp`

Hook input fields used (Claude Code hook stdin JSON): `hook_event_name`, `session_id`, `cwd`, `source` (SessionStart: `startup|resume|clear|compact`), `reason` (SessionEnd), `tool_name`, `tool_input.command` (PostToolUse).

- [ ] **Step 1: Write the failing tests**

Create `tests/journal-hook.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, journalDir, listSlugs, readEvents } from '../src/journal.js';
import { localDate } from '../src/payloads.js';
import { handleHook } from '../scripts/journal-hook.js';
import { reminderText } from '../scripts/session-reminder.js';
import { gitIn, makeRepo } from './helpers.js';

const SCRIPT = fileURLToPath(new URL('../scripts/journal-hook.js', import.meta.url));
const DAY = '2026-10-16';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo('tdm');
  const hook = (input, over = {}) =>
    handleHook({ session_id: 'S1', cwd: repo, ...input }, { home, today: DAY, configured: true, pluginRoot: '/plug', ...over });
  return { home, repo, hook, events: () => readEvents(home, 'tdm', DAY).events };
}

const context = (out) => JSON.parse(out).hookSpecificOutput.additionalContext;

test('SessionStart startup: records the start and gives reminder + journal context', () => {
  const s = setup();
  const out = s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(context(out).startsWith(reminderText({ configured: true })));
  assert.match(context(out), /opflow journal — project "tdm", session S1\./);
  assert.match(context(out), /node "\/plug\/bin\/opflow\.js" journal:note --session S1/);
  const [start] = s.events();
  assert.deepEqual(
    { kind: start.kind, session: start.session, source: start.source, trigger: start.trigger, head: start.head },
    { kind: 'session_start', session: 'S1', source: 'hook', trigger: 'startup', head: gitIn(s.repo, 'rev-parse', 'HEAD') },
  );
  assert.ok(start.branch);
});

test('SessionStart resume/clear/compact: context without the reminder', () => {
  const s = setup();
  for (const source of ['resume', 'clear', 'compact']) {
    const text = context(s.hook({ hook_event_name: 'SessionStart', source }));
    assert.ok(!text.includes(reminderText({ configured: true })), source);
    assert.match(text, /opflow journal — project "tdm"/);
  }
  assert.deepEqual(s.events().map((e) => e.trigger), ['resume', 'clear', 'compact']);
});

test('SessionStart: not configured -> setup reminder; previous-day partials in context', () => {
  const s = setup();
  appendEvent(s.home, 'tdm', '2026-10-14', { session: 'S0', source: 'claude', kind: 'bug', status: 'partial', text: 'Old' });
  appendEvent(s.home, 'tdm', '2026-10-15', { session: 'S0', source: 'claude', kind: 'bug', status: 'partial', text: 'Refund rounding' });
  const text = context(s.hook({ hook_event_name: 'SessionStart', source: 'startup' }, { configured: false }));
  assert.ok(text.startsWith(reminderText({ configured: false })));
  assert.match(text, /Unfinished from 2026-10-15:\n- Refund rounding \[partial\]/);
  assert.doesNotMatch(text, /Old/);
});

test('PostToolUse: a new commit is recorded once; non-commit commands do nothing', () => {
  const s = setup();
  s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } }), '');
  gitIn(s.repo, 'commit', '-q', '--allow-empty', '-m', 'feat: csv export');
  const commit = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "feat: csv export"' } };
  assert.equal(s.hook(commit), '');
  s.hook(commit);
  const commits = s.events().filter((e) => e.kind === 'commit');
  assert.equal(commits.length, 1);
  assert.deepEqual([commits[0].hash, commits[0].subject, commits[0].session], [gitIn(s.repo, 'rev-parse', 'HEAD'), 'feat: csv export', 'S1']);
});

test('PostToolUse: "commit" in a command without a new commit records nothing', () => {
  const s = setup();
  s.hook({ hook_event_name: 'SessionStart', source: 'startup' });
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git log --grep commit' } });
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell', tool_input: { command: 'git commit -m "nothing staged"' } });
  assert.deepEqual(s.events().map((e) => e.kind), ['session_start']);
});

test('PostToolUse: a non-commit command never touches ~/.opflow', () => {
  const s = setup();
  s.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(listSlugs(s.home), []);
  assert.equal(existsSync(join(s.home, 'projects.json')), false);
});

test('SessionEnd records the end with HEAD and reason', () => {
  const s = setup();
  assert.equal(s.hook({ hook_event_name: 'SessionEnd', reason: 'logout' }), '');
  const [end] = s.events();
  assert.deepEqual([end.kind, end.reason, end.head], ['session_end', 'logout', gitIn(s.repo, 'rev-parse', 'HEAD')]);
});

test('script: reads stdin, uses OPFLOW_HOME and today, checks .env for the reminder', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const repo = makeRepo('tdm');
  const run = () =>
    spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'S1', cwd: repo }),
      env: { ...process.env, OPFLOW_HOME: home },
      encoding: 'utf8',
    });
  const before = run();
  assert.equal(before.status, 0);
  assert.ok(context(before.stdout).startsWith(reminderText({ configured: false })));
  assert.equal(readEvents(home, 'tdm', localDate()).events.length, 1);
  writeFileSync(join(home, '.env'), 'OP_URL=x');
  assert.ok(context(run().stdout).startsWith(reminderText({ configured: true })));
});

test('script: never fails the session; logs errors; startup still gets the reminder', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const bad = spawnSync(process.execPath, [SCRIPT], { input: 'not json', env: { ...process.env, OPFLOW_HOME: home }, encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.match(readFileSync(join(journalDir(home), 'errors.log'), 'utf8'), /SyntaxError/);

  const fileHome = join(home, 'not-a-dir');
  writeFileSync(fileHome, 'x');
  const broken = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'S1', cwd: makeRepo() }),
    env: { ...process.env, OPFLOW_HOME: fileHome },
    encoding: 'utf8',
  });
  assert.equal(broken.status, 0);
  assert.equal(context(broken.stdout), reminderText({ configured: false }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/journal-hook.test.js`
Expected: FAIL — `Cannot find module '../scripts/journal-hook.js'`.

- [ ] **Step 3: Update `scripts/session-reminder.js`**

Replace the whole file with:

```js
// The opflow reminder that the SessionStart journal hook (journal-hook.js) adds on startup.
const NEVER =
  'Never run opflow commands or the opflow CLI unless the user types the command themselves, except journal:note, which you run yourself as the opflow journal context describes.';

export function reminderText({ configured }) {
  if (!configured) {
    return `opflow (OpenProject + Nextcloud Talk) is installed but not set up. Mention once, in one short line at the end of your first reply, that the user can type /opflow:setup to connect their accounts. ${NEVER}`;
  }
  return [
    'opflow (OpenProject + Nextcloud Talk) is available. Mention it once, in one short line at the end of your first reply:',
    'the user can type /opflow:plan-feature <feature> to plan work into the sprint, and /opflow:done-tasks and /opflow:report-day when wrapping up.',
    'If the user later says they are done for the day, you may remind them of /opflow:done-tasks and /opflow:report-day once more.',
    NEVER,
  ].join(' ');
}
```

Replace `tests/session-reminder.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderText } from '../scripts/session-reminder.js';

test('configured: names the namespaced commands, once, never run unasked except journal:note', () => {
  const text = reminderText({ configured: true });
  for (const cmd of ['/opflow:plan-feature', '/opflow:done-tasks', '/opflow:report-day']) assert.ok(text.includes(cmd), cmd);
  assert.match(text, /once/);
  assert.match(text, /never run/i);
  assert.match(text, /except journal:note/);
  assert.doesNotMatch(text, /\/opflow:setup/);
});

test('not configured: only points to /opflow:setup', () => {
  const text = reminderText({ configured: false });
  assert.match(text, /\/opflow:setup/);
  assert.doesNotMatch(text, /\/opflow:plan-feature/);
  assert.match(text, /never run/i);
});
```

- [ ] **Step 4: Implement `scripts/journal-hook.js`**

```js
// Claude Code hook (SessionStart, PostToolUse on Bash/PowerShell, SessionEnd): keeps the session journal and
// gives Claude the project's journal context. Always exits 0; errors go to ~/.opflow/journal/errors.log.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFile, opflowHome } from '../src/home.js';
import { appendEvent, collapseItems, journalDir, knownHead, listDates, readEvents, sessionsWithoutEnd } from '../src/journal.js';
import { sessionContext } from '../src/journal-view.js';
import { isMainModule } from '../src/main-module.js';
import { localDate } from '../src/payloads.js';
import { identifyProject, runGit, toPosix } from '../src/project.js';
import { reminderText } from './session-reminder.js';

export const COMMIT_COMMAND = /\bgit\b[\s\S]*\bcommit\b/;

const sessionStartOutput = (text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });

function onSessionStart(input, { home, today, configured, pluginRoot, git }, project, session) {
  const { events } = readEvents(home, project.slug, today);
  const head = git(['rev-parse', 'HEAD'], project.root);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], project.root);
  const trigger = input.source ?? 'startup';
  appendEvent(home, project.slug, today, {
    session, source: 'hook', kind: 'session_start', trigger, cwd: toPosix(input.cwd ?? project.root),
    ...(branch ? { branch } : {}), ...(head ? { head } : {}),
  });
  const previousDate = listDates(home, project.slug).filter((d) => d < today).at(-1);
  const context = sessionContext({
    slug: project.slug,
    session,
    todayItems: collapseItems(events),
    previous: previousDate ? { date: previousDate, items: collapseItems(readEvents(home, project.slug, previousDate).events) } : null,
    otherOpen: sessionsWithoutEnd(events, session).length,
    cli: `node "${pluginRoot}/bin/opflow.js"`,
  });
  return sessionStartOutput(trigger === 'startup' ? `${reminderText({ configured })}\n\n${context}` : context);
}

// Records HEAD after a command that looks like a commit, only if HEAD moved since this session last saw it.
function onCommand({ home, today, git }, project, session) {
  const hash = git(['rev-parse', 'HEAD'], project.root);
  if (!hash) return '';
  const { events } = readEvents(home, project.slug, today);
  if (knownHead(events, session) === hash || events.some((e) => e.kind === 'commit' && e.hash === hash)) return '';
  const subject = git(['log', '-1', '--format=%s'], project.root) ?? '';
  appendEvent(home, project.slug, today, { session, source: 'hook', kind: 'commit', hash, subject });
  return '';
}

function onSessionEnd(input, { home, today, git }, project, session) {
  const head = git(['rev-parse', 'HEAD'], project.root);
  appendEvent(home, project.slug, today, { session, source: 'hook', kind: 'session_end', reason: input.reason ?? 'other', ...(head ? { head } : {}) });
  return '';
}

export function handleHook(input, deps) {
  const ctx = { git: runGit, ...deps };
  const event = input.hook_event_name;
  if (event === 'PostToolUse' && !COMMIT_COMMAND.test(input.tool_input?.command ?? '')) return '';
  if (!['SessionStart', 'PostToolUse', 'SessionEnd'].includes(event)) return '';
  const project = identifyProject(ctx.home, input.cwd ?? process.cwd(), ctx.git);
  const session = input.session_id ?? 'unknown';
  if (event === 'SessionStart') return onSessionStart(input, ctx, project, session);
  if (event === 'PostToolUse') return onCommand(ctx, project, session);
  return onSessionEnd(input, ctx, project, session);
}

function logError(home, err) {
  try {
    mkdirSync(journalDir(home), { recursive: true });
    appendFileSync(join(journalDir(home), 'errors.log'), `${new Date().toISOString()} ${err?.stack ?? err}\n`);
  } catch {
    // Nowhere to log; the session must carry on regardless.
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const home = opflowHome();
  const configured = existsSync(envFile(home));
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    const out = handleHook(input, { home, today: localDate(), configured, pluginRoot: toPosix(fileURLToPath(new URL('..', import.meta.url))) });
    if (out) process.stdout.write(`${out}\n`);
  } catch (err) {
    logError(home, err);
    if (input?.hook_event_name === 'SessionStart' && (input.source ?? 'startup') === 'startup') {
      process.stdout.write(`${sessionStartOutput(reminderText({ configured }))}\n`);
    }
  }
  process.exitCode = 0;
}
```

- [ ] **Step 5: Wire `hooks/hooks.json`**

Replace the file with:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/journal-hook.js\"" }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/journal-hook.js\"" }]
      }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/journal-hook.js\"" }] }
    ]
  }
}
```

In `tests/plugin.test.js`, replace the test `'hooks.json runs the existing session reminder on startup'` with:

```js
test('hooks.json runs the journal hook on every session start, Bash/PowerShell use and session end', () => {
  const { hooks } = JSON.parse(read('hooks/hooks.json'));
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-hook.js"';
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionEnd', 'SessionStart']);
  assert.equal(hooks.SessionStart[0].matcher, undefined, 'all SessionStart sources');
  assert.equal(hooks.PostToolUse[0].matcher, 'Bash|PowerShell');
  for (const name of Object.keys(hooks)) assert.equal(hooks[name][0].hooks[0].command, command, name);
  assert.ok(existsSync(join(ROOT, 'scripts/journal-hook.js')));
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/journal-hook.test.js tests/session-reminder.test.js tests/plugin.test.js` → all PASS. Then `npm test` → all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/journal-hook.js scripts/session-reminder.js hooks/hooks.json tests/journal-hook.test.js tests/session-reminder.test.js tests/plugin.test.js
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: journal hook records sessions and commits and loads project context"
```

---

### Task 6: Setup allow rule, docs, version

**Files:**
- Modify: `src/setup.js` (`ALLOW_RULES`, rule sets written once)
- Modify: `tests/setup.test.js`
- Modify: `README.md`, `DOCUMENTATION.md`, `package.json`, `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: existing `ASK_RULES`, `confirm`, `printRules` in `src/setup.js`.
- Produces: `ALLOW_RULES = ['Bash(node *opflow.js* journal:note*)', 'PowerShell(node *opflow.js* journal:note*)']` exported from `src/setup.js`.

- [ ] **Step 1: Update the setup tests (failing)**

In `tests/setup.test.js`:

1. Import `ALLOW_RULES` alongside `ASK_RULES`.
2. In `'setup adds the approval rules to Claude settings, keeping everything else and a backup'`, change the prompter to `fakePrompter([...full(), '', ''])`, replace the `prompts.at(-1)` assertion with:

```js
  assert.ok(prompter.prompts.at(-2).startsWith('Make Claude Code ask you before every opflow write'), prompter.prompts.at(-2));
  assert.ok(prompter.prompts.at(-1).startsWith('Let Claude record journal notes without asking'), prompter.prompts.at(-1));
```

   and the `after` assertion with:

```js
  assert.deepEqual(after, { model: 'x', permissions: { allow: ['Read', ...ALLOW_RULES], ask: ['Other(y)', ...ASK_RULES] } });
```

3. In `'approval rules: created when settings are missing, never duplicated, no question once present'`, change the first expected value to `{ permissions: { ask: ASK_RULES, allow: ALLOW_RULES } }` and add after the last assertion:

```js
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')).permissions.allow, ALLOW_RULES);
```

4. In `'approval rules: "n" or unreadable settings leave the file alone and print the rules'`, change the prompter to `fakePrompter([...full(), answer, answer])` and add after the ASK_RULES loop:

```js
    for (const rule of ALLOW_RULES) assert.ok(lines.some((l) => l.includes(rule)), `${content}: ${rule}`);
```

5. Add a new test:

```js
test('journal rule: yes to ask rules, no to journal rule writes only the ask rules', async () => {
  const { home, root, settingsFile } = dirs();
  await run({ home, root, prompter: fakePrompter([...full(), '', 'n']) });
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { permissions: { ask: ASK_RULES } });
});
```

Run: `node --test tests/setup.test.js`
Expected: FAIL — `ALLOW_RULES` is not exported / assertions differ.

- [ ] **Step 2: Implement in `src/setup.js`**

After `ASK_RULES`, add:

```js
export const ALLOW_RULES = ['Bash(node *opflow.js* journal:note*)', 'PowerShell(node *opflow.js* journal:note*)'];

const RULE_SETS = [
  {
    list: 'ask',
    rules: ASK_RULES,
    question: (n, file) => `Make Claude Code ask you before every opflow write (adds ${n} rules to ${file})? [Y/n]: `,
    present: 'Approval rules are already in your Claude Code settings.',
  },
  {
    list: 'allow',
    rules: ALLOW_RULES,
    question: (n, file) => `Let Claude record journal notes without asking each time (adds ${n} rules to ${file})? [Y/n]: `,
    present: 'Journal rules are already in your Claude Code settings.',
  },
];
```

Replace `printRules` and `addApprovalRules` with:

```js
function printRules(log, { list, rules }) {
  log(`Add both of these to "permissions.${list}" in ~/.claude/settings.json yourself:`);
  for (const rule of rules) log(`  "${rule}"`);
}

// Adds RULE_SETS to Claude Code's permissions after asking about each; writes once, keeps a backup of the
// original, and never touches a file it can't parse.
async function addApprovalRules(settingsFile, prompter, log) {
  let raw = null;
  try {
    raw = await readFile(settingsFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let settings = {};
  try {
    if (raw !== null) settings = JSON.parse(raw);
  } catch {
    settings = null;
  }
  log('');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    log(`Couldn't read ${settingsFile} as JSON, so it was left unchanged.`);
    return RULE_SETS.forEach((set) => printRules(log, set));
  }
  let next = settings;
  for (const set of RULE_SETS) {
    const current = Array.isArray(next.permissions?.[set.list]) ? next.permissions[set.list] : [];
    const missing = set.rules.filter((rule) => !current.includes(rule));
    if (!missing.length) {
      log(set.present);
      continue;
    }
    if (!(await confirm(prompter, set.question(missing.length, settingsFile)))) {
      printRules(log, set);
      continue;
    }
    next = { ...next, permissions: { ...next.permissions, [set.list]: [...current, ...missing] } };
  }
  if (next === settings) return;
  if (raw !== null) await writeFile(`${settingsFile}.opflow-backup`, raw);
  await mkdir(dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
  log(`Updated ${settingsFile}${raw !== null ? ` (backup: ${settingsFile}.opflow-backup)` : ''}.`);
}
```

- [ ] **Step 3: Run the tests**

Run: `node --test tests/setup.test.js` → all PASS. Then `npm test` → all PASS.

- [ ] **Step 4: Docs and version**

`package.json` and `.claude-plugin/plugin.json`: `"version": "0.3.0"`.

`README.md`:
- In **Approval rules**, after the ask-rules block, add:

```markdown
Setup then asks whether Claude may record journal notes without asking each time. Say **Y** to add these to
`permissions.allow` (they only allow `journal:note`, which writes to your local journal and nowhere else):

```json
"Bash(node *opflow.js* journal:note*)", "PowerShell(node *opflow.js* journal:note*)"
```
```

- After the **Daily use** command list, add a section:

```markdown
### Session journal

opflow keeps a local journal of the **features you built and bugs you fixed**, per project and per day, in
`~/.opflow/journal/<project>/<date>.jsonl`. It needs no setup and never sends anything anywhere.

- **Automatic:** a hook records when each Claude Code session starts and ends, and every commit made in it.
- **Claude's notes:** when a feature is finished (or partly built) or a bug is fixed, Claude records one line with
  `journal:note`. A note is linked to the session's latest commit; work with no commit shows as "not committed".
- **Context:** each new session in a project starts with what was recorded there today and anything left
  unfinished on the last day you worked on it.
- **See it:** `node "<plugin folder>/bin/opflow.js" journal:show [--project tdm] [--date 2026-10-16]`.

Projects are identified by their git repo (worktrees count as the main repo); `~/.opflow/projects.json` maps each
repo to its short name.
```

- In **CLI**, add:

```
node "<plugin folder>/bin/opflow.js" journal:note --kind feature|bug --status done|partial --text "..." [--ticket <id>] [--commit <hash>]
node "<plugin folder>/bin/opflow.js" journal:show [--project <name>] [--date YYYY-MM-DD] [--json]
```

`DOCUMENTATION.md`:
- Section 3.6: rename to **Session reminder and journal hook** and replace its paragraph with:

```markdown
The plugin includes one hook script, `scripts/journal-hook.js`, so there's nothing to set up. It runs when a session
starts, after Bash/PowerShell commands, and when a session ends:

- At the start of each new session, Claude mentions the opflow commands once, in one line (only `/opflow:setup`
  until you've run setup), and gets the project's journal context (see the README's **Session journal**).
- After a command that commits, it records the new commit in the journal.
- It never runs anything against OpenProject or Talk, and never fails a session: errors are written to
  `~/.opflow/journal/errors.log`.
```

- Section 7 file list: replace the `hooks/hooks.json` and `scripts/session-reminder.js` lines and add the new files:

```
hooks/hooks.json      SessionStart / PostToolUse / SessionEnd → scripts/journal-hook.js
src/project.js        repo root detection and ~/.opflow/projects.json
src/journal.js        journal files: append, read, collapse notes
src/journal-view.js   journal:show Markdown and the session-start context
src/journal-cli.js    journal:note and journal:show
scripts/journal-hook.js      the journal hook (session start/end, commits, context)
scripts/session-reminder.js  the reminder text the hook adds on startup
```

  and change the `src/cli.js` line's "the five commands" to "the OpenProject and Talk commands".

- [ ] **Step 5: Final check**

Run: `npm test` → all PASS. Run `node bin/opflow.js help` and confirm the journal commands are listed.

- [ ] **Step 6: Commit**

```bash
git add src/setup.js tests/setup.test.js README.md DOCUMENTATION.md package.json .claude-plugin/plugin.json
git -c user.name=ry-apollotech -c user.email=ryanjohn@apollo.com.ph commit -m "feat: setup offers journal allow rules; document the session journal (0.3.0)"
```

---

## After the plan: manual check in Claude Code

Not automatable here; do it once after Task 6 and before calling sub-project 1 done:

1. `claude plugin marketplace add /mnt/c/Users/Ryan/Documents/OpenProject` (already added) → `/plugin update opflow`, restart Claude Code in a test repo.
2. Confirm the first reply ends with the opflow line, and that `~/.opflow/journal/<repo>/<today>.jsonl` has a `session_start` line.
3. Make a commit through Claude → a `commit` line appears. Ask Claude to note a feature → `journal:show` lists it with the commit.
4. Note how long a Bash command takes with the hook vs without (Windows/PowerShell especially). If it's noticeable, raise it before sub-project 2.
