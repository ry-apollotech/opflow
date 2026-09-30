# opflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship opflow as a Claude Code plugin that teammates install from a private GitHub repo. Each dev's
credentials, ticket-breakdown preferences and report template live in `~/.opflow/`, filled by an interactive
`setup` command.

**Architecture:**
- **Plugin:** the repo becomes both the plugin and its own marketplace (`.claude-plugin/plugin.json` +
  `marketplace.json`).
- **Skills:** they call the CLI through `${CLAUDE_PLUGIN_ROOT}`. The skill files keep no install-time
  placeholders.
- **Config:** per-user config moves from `<repo>/.env` to `~/.opflow/`, written by `node bin/opflow.js setup`.
- **Plan rules:** `/opflow:plan-feature` fetches its breakdown rules at run time with `plan:rules`.
- **Session reminder:** ships in `hooks/hooks.json`.

**Tech Stack:** Node.js ≥ 18, ES modules, zero npm dependencies, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-30-opflow-plugin-design.md`

## Global Constraints

- Node.js **18 or newer**, **no npm dependencies** (built-ins only).
- Write commands stay **dry runs unless `--yes`**. Every skill keeps "Never run a command with `--yes` without an
  explicit **Approve**".
- Every skill keeps `disable-model-invocation: true`.
- **Secrets are never printed in full.** This covers `OP_API_KEY` and `NC_APP_PASSWORD` in prompts, logs and
  errors. Masked form: `****` + last 4 characters.
- Per-user folder: `$OPFLOW_HOME` if set, else `<homedir>/.opflow`. `.env` is written with mode `0600`, the
  folder with `0700`.
- Plugin name `opflow`, marketplace name `opflow`, GitHub repo `<owner>/opflow` (owner still to be decided).
- Skills invoke the CLI exactly as `node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" …` (path quoted).
- Ask rules stay `Bash(node *opflow.js*--yes*)` and `PowerShell(node *opflow.js*--yes*)`.
- Existing behaviour is unchanged:
  - points 1/2/4 (2h/4h/8h), 60-point sprint, `OP_BACKLOG` overflow;
  - the three ticket-breakdown questions and their rules text;
  - the report template rules.

## Review Focus

1. **Values with spaces, `#`, `:` or quotes** (e.g. `OP_BACKLOG="Backlog: Android POS"`, a password containing
   `#` or `"`) must survive setup's `.env` write and `parseEnv` read unchanged. Test in Task 3.
2. **Re-running setup on an existing config:** pressing Enter keeps every value, and no prompt shows a secret in
   full. Test in Task 3.
3. **Paths on Windows.**
   - A plugin path with spaces (`C:\Users\Ryan Smith\.claude\plugins\…`): every CLI call in every skill must
     quote the path. Test in Task 4.
   - `--file ~/.opflow/tasks.json` run from PowerShell: PowerShell does not expand `~` for `node`, so the CLI must
     expand a leading `~/` or `~\` itself. Test in Task 2.
4. **Running setup without a terminal** (e.g. through `!` in Claude Code or a pipe) must fail with the exact
   command to run in a terminal, not hang or write a half-empty `.env`. Test in Task 2.
5. **First session before setup:** the session reminder must say to run `/opflow:setup` first, and must not
   suggest the other commands as ready. Test in Task 4.

---

### Task 1: Per-user home folder, config loading, and shared helpers

Moves `isMainModule` (with the drive-path fix from `a57fe8e`) and `preferences.js` to `src/`, so the CLI can use
them without importing from `scripts/`.

**Files:**
- Create: `src/home.js`, `src/main-module.js`
- Move: `scripts/preferences.js` → `src/preferences.js` (content unchanged)
- Modify: `tests/preferences.test.js` (import path), `scripts/session-reminder.js` (import path)
- Test: `tests/home.test.js`, `tests/main-module.test.js`

**Interfaces:**
- Produces:
  - `opflowHome(env = process.env): string`
  - `envFile(home): string`
  - `preferencesFile(home): string`
  - `reportTemplateFile(home): string`
  - `NOT_SET_UP: string`
  - `loadUserConfig(home, env = process.env): Config`, which throws `NOT_SET_UP` when there is neither
    `<home>/.env` nor `env.OP_URL`
  - `isMainModule(argvPath, moduleUrl, plat?): boolean` from `src/main-module.js`
  - `src/preferences.js` exports unchanged: `QUESTIONS, DEFAULTS, normalizePreferences, planRules,
    askPreferences, loadPreferences, savePreferences`

- [ ] **Step 1: Move preferences and fix its imports**

```bash
git mv scripts/preferences.js src/preferences.js
```

In `tests/preferences.test.js` change `from '../scripts/preferences.js'` to `from '../src/preferences.js'`.
In `scripts/install.js` change `from './preferences.js'` to `from '../src/preferences.js'`. The file is deleted
in Task 4; this only keeps the suite green until then.

- [ ] **Step 2: Write the failing tests**

`tests/home.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOT_SET_UP, envFile, loadUserConfig, opflowHome, preferencesFile, reportTemplateFile } from '../src/home.js';

const full = [
  'OP_URL=https://op.test', 'OP_API_KEY=k', 'OP_PROJECT=p', 'NC_URL=https://nc.test',
  'NC_USER=u', 'NC_APP_PASSWORD=pw', 'NC_TALK_ROOM=r',
].join('\n');

test('opflowHome honours OPFLOW_HOME and defaults to ~/.opflow', () => {
  assert.equal(opflowHome({ OPFLOW_HOME: '/x/y' }), '/x/y');
  assert.equal(opflowHome({}), join(homedir(), '.opflow'));
});

test('file helpers live inside the home folder', () => {
  assert.equal(envFile('/h'), join('/h', '.env'));
  assert.equal(preferencesFile('/h'), join('/h', 'preferences.json'));
  assert.equal(reportTemplateFile('/h'), join('/h', 'report-template.md'));
});

test('loadUserConfig says to run setup when nothing is configured', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  assert.throws(() => loadUserConfig(home, {}), { message: NOT_SET_UP });
  assert.equal(NOT_SET_UP, 'opflow is not set up. Run /opflow:setup in Claude Code.');
});

test('loadUserConfig reads <home>/.env', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  writeFileSync(envFile(home), full);
  assert.equal(loadUserConfig(home, {}).op.url, 'https://op.test');
});
```

`tests/main-module.test.js` (the test that used to live in `tests/install.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMainModule } from '../src/main-module.js';

test('isMainModule compares case-insensitively on win32 and case-sensitively elsewhere', () => {
  const url = 'file:///C:/repo/scripts/install.js';
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'win32'), true);
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'linux'), false);
  assert.equal(isMainModule('C:/repo/scripts/install.js', url, 'linux'), true);
  assert.equal(isMainModule(undefined, url, 'win32'), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/home.test.js tests/main-module.test.js`
Expected: FAIL with `Cannot find module '…/src/home.js'`

- [ ] **Step 4: Implement**

`src/main-module.js`:

```js
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

// fileURLToPath on a POSIX host keeps the leading slash of a Windows drive path
// (/C:/…); drop it so a drive-letter path compares the same regardless of host.
const fileUrlPath = (moduleUrl) => toPosix(fileURLToPath(moduleUrl)).replace(/^\/([a-zA-Z]:)/, '$1');

export function isMainModule(argvPath, moduleUrl, plat = platform()) {
  if (!argvPath) return false;
  const a = toPosix(argvPath);
  const b = fileUrlPath(moduleUrl);
  return plat === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
```

`src/home.js`:

```js
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

export const NOT_SET_UP = 'opflow is not set up. Run /opflow:setup in Claude Code.';

export function opflowHome(env = process.env) {
  return env.OPFLOW_HOME || join(homedir(), '.opflow');
}

export const envFile = (home) => join(home, '.env');
export const preferencesFile = (home) => join(home, 'preferences.json');
export const reportTemplateFile = (home) => join(home, 'report-template.md');

export function loadUserConfig(home, env = process.env) {
  if (!existsSync(envFile(home)) && !env.OP_URL) throw new Error(NOT_SET_UP);
  return loadConfig(envFile(home), env);
}
```

In `scripts/session-reminder.js` change `import { isMainModule } from './install.js';` to
`import { isMainModule } from '../src/main-module.js';`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/home.js src/main-module.js src/preferences.js tests/home.test.js tests/main-module.test.js tests/preferences.test.js scripts/session-reminder.js scripts/install.js
git commit -m "refactor: per-user ~/.opflow home and shared helpers under src/"
```

---

### Task 2: CLI reads `~/.opflow`, adds `plan:rules`, refuses `setup` without a terminal

**Files:**
- Modify: `bin/opflow.js` (whole file below)
- Modify: `src/cli.js` (USAGE text only)
- Test: `tests/bin.test.js`

**Interfaces:**
- Consumes: `opflowHome`, `loadUserConfig`, `preferencesFile`, `NOT_SET_UP` (Task 1); `planRules`,
  `loadPreferences` (src/preferences.js); `runSetup`, `createTerminalPrompter` (Task 3; the `setup` branch is
  wired in Task 3, Step 6).
- Produces:
  - `opflow plan:rules` prints the rules to stdout and exits 0.
  - A missing config exits 1 with `Error: <NOT_SET_UP>` on stderr.
  - `opflow setup` exits 1 without a TTY (text below).
  - `parseArgs` expands a leading `~/` or `~\` in `--file` to the home directory.

- [ ] **Step 1: Write the failing tests**

`tests/bin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, planRules } from '../src/preferences.js';

const BIN = fileURLToPath(new URL('../bin/opflow.js', import.meta.url));

function opflow(args, home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OP|NC)_/.test(k)));
  return spawnSync(process.execPath, [BIN, ...args], { env: { ...env, OPFLOW_HOME: home }, encoding: 'utf8', stdio: 'pipe' });
}

const tempHome = () => mkdtempSync(join(tmpdir(), 'opflow-'));

test('plan:rules prints the default rules when nothing is saved', () => {
  const r = opflow(['plan:rules'], tempHome());
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), planRules(DEFAULTS));
});

test('plan:rules follows saved preferences', () => {
  const home = tempHome();
  writeFileSync(join(home, 'preferences.json'), JSON.stringify({ ...DEFAULTS, size: 'fewer' }));
  assert.match(opflow(['plan:rules'], home).stdout, /Never more than 5 stories/);
});

test('commands that need credentials say to run setup first', () => {
  const r = opflow(['check'], tempHome());
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), 'Error: opflow is not set up. Run /opflow:setup in Claude Code.');
});

test('setup without a terminal exits 1 with the command to run', () => {
  const r = opflow(['setup'], tempHome());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /setup needs a terminal/);
  assert.ok(r.stderr.includes(`node "${BIN.replaceAll('\\', '/')}" setup`), r.stderr);
});
```

Add to `tests/cli.test.js` (it already imports `parseArgs`; add `import { homedir } from 'node:os';` and
`import { join } from 'node:path';` at the top):

```js
test('parseArgs expands a leading ~ in --file (PowerShell passes it through literally)', () => {
  assert.equal(parseArgs(['op:create', '--file', '~/.opflow/t.json']).file, join(homedir(), '.opflow/t.json'));
  assert.equal(parseArgs(['op:create', '--file', '~\\.opflow\\t.json']).file, join(homedir(), '.opflow\\t.json'));
  assert.equal(parseArgs(['op:create', '--file', 'a/~/t.json']).file, 'a/~/t.json');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin.test.js tests/cli.test.js`
Expected: FAIL (`plan:rules` prints usage; `check` reports `Missing config keys`; `setup` prints usage).

- [ ] **Step 3: Implement `bin/opflow.js`**

```js
#!/usr/bin/env node
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run, USAGE } from '../src/cli.js';
import { loadUserConfig, opflowHome, preferencesFile } from '../src/home.js';
import { createOpenProjectClient } from '../src/openproject.js';
import { localDate } from '../src/payloads.js';
import { loadPreferences, planRules } from '../src/preferences.js';
import { createTalkClient } from '../src/talk.js';

const argv = process.argv.slice(2);
const home = opflowHome();
const self = fileURLToPath(import.meta.url).replaceAll('\\', '/');

export function cliDeps(config) {
  return {
    op: createOpenProjectClient(config.op),
    talk: createTalkClient(config.nc),
    readFile: (path) => readFile(path, 'utf8'),
    removeFile: (path) => unlink(path),
    log: (line) => console.log(line),
    today: localDate(),
    backlog: config.op.backlog,
  };
}

async function setup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`setup needs a terminal. Run it in your own terminal:\n  node "${self}" setup`);
    return 1;
  }
  console.error('setup is not available yet');
  return 1;
}

async function main() {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] === 'setup') return setup();
  if (argv[0] === 'plan:rules') {
    console.log(planRules(await loadPreferences(preferencesFile(home))));
    return 0;
  }
  return run(argv, cliDeps(loadUserConfig(home)));
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
```

In `src/cli.js`, add `import { homedir } from 'node:os';` and `import { join } from 'node:path';`. In
`parseArgs`, replace `else if (arg === '--file') opts.file = rest[++i] ?? null;` with:

```js
    else if (arg === '--file') opts.file = expandHome(rest[++i] ?? null);
```

Add above `parseArgs`:

```js
// PowerShell doesn't expand ~ for native programs, so skills' ~/.opflow/... paths are expanded here.
function expandHome(path) {
  return path && /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
}
```

Also in USAGE, add these two lines under `Commands:`, before `check`:

```
  setup [--keep-preferences]     Set up credentials, ticket breakdown and report template (interactive)
  plan:rules                     Print your /opflow:plan-feature ticket-breakdown rules
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass. The `setup` test passes because the TTY guard comes first.

- [ ] **Step 5: Commit**

```bash
git add bin/opflow.js src/cli.js tests/bin.test.js tests/cli.test.js
git commit -m "feat: CLI reads ~/.opflow, adds plan:rules, setup requires a terminal"
```

---

### Task 3: Interactive `setup`

**Files:**
- Create: `src/setup.js`
- Modify: `bin/opflow.js` (`setup()` function)
- Test: `tests/setup.test.js`

**Interfaces:**
- Consumes: `envFile`, `preferencesFile`, `reportTemplateFile` (Task 1); `parseEnv` (src/config.js);
  `askPreferences`, `loadPreferences`, `savePreferences` (src/preferences.js).
- Produces:
  - `FIELDS: {key, label, hint, secret}[]`
  - `ASK_RULES: string[]`
  - `maskSecret(value): string`
  - `formatEnv(values): string`
  - `copyIfMissing(source, target): Promise<boolean>`
  - `runSetup({ home, root, prompter, log, runCheck, keepPreferences?, migrateFrom? }): Promise<number>`
  - `createTerminalPrompter(input, output): { ask(q), askSecret(q), close() }`

- [ ] **Step 1: Write the failing tests**

`tests/setup.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../src/config.js';
import { DEFAULTS } from '../src/preferences.js';
import { ASK_RULES, FIELDS, copyIfMissing, formatEnv, maskSecret, runSetup } from '../src/setup.js';

const answers = {
  OP_URL: 'https://op.example.com/', OP_API_KEY: 'op-secret-1234', OP_PROJECT: 'iconnect',
  OP_BACKLOG: 'Backlog: Android POS', NC_URL: 'https://cloud.example.com', NC_USER: 'ryan',
  NC_APP_PASSWORD: 'nc-secret-9876', NC_TALK_ROOM: 'abc123',
};

function fakePrompter(lines) {
  const queue = [...lines];
  const prompts = [];
  const next = async (q) => { prompts.push(q); return queue.shift() ?? ''; };
  return { ask: next, askSecret: next, prompts };
}

function dirs() {
  const home = mkdtempSync(join(tmpdir(), 'opflow-home-'));
  const root = mkdtempSync(join(tmpdir(), 'opflow-root-'));
  writeFileSync(join(root, 'report-template.example.md'), 'default template');
  return { home, root };
}

const run = (opts) => runSetup({ log: () => {}, runCheck: async () => 0, ...opts });

test('FIELDS covers every config key in order, secrets flagged', () => {
  assert.deepEqual(FIELDS.map((f) => f.key), Object.keys(answers));
  assert.deepEqual(FIELDS.filter((f) => f.secret).map((f) => f.key), ['OP_API_KEY', 'NC_APP_PASSWORD']);
});

test('maskSecret shows only the last 4 characters', () => {
  assert.equal(maskSecret('op-secret-1234'), '****1234');
  assert.equal(maskSecret('abc'), '****');
});

test('formatEnv round-trips awkward values through parseEnv', () => {
  const values = { ...answers, NC_APP_PASSWORD: 'p#ss "word" \'x\'', OP_BACKLOG: 'Backlog: Android POS' };
  assert.deepEqual(parseEnv(formatEnv(values)), values);
});

test('first setup writes .env, preferences and the report template, then runs check', async () => {
  const { home, root } = dirs();
  let checked = 0;
  const prompter = fakePrompter([...Object.values(answers), '2', '', '']);
  const code = await run({ home, root, prompter, runCheck: async () => { checked++; return 0; } });
  assert.equal(code, 0);
  assert.equal(checked, 1);
  const env = parseEnv(readFileSync(join(home, '.env'), 'utf8'));
  assert.equal(env.OP_URL, 'https://op.example.com');
  assert.equal(env.OP_BACKLOG, 'Backlog: Android POS');
  assert.equal(env.NC_APP_PASSWORD, 'nc-secret-9876');
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'preferences.json'), 'utf8')), { ...DEFAULTS, testing: 'excluded' });
  assert.equal(readFileSync(join(home, 'report-template.md'), 'utf8'), 'default template');
  if (process.platform !== 'win32') assert.equal(statSync(join(home, '.env')).mode & 0o777, 0o600);
});

test('re-running setup: Enter keeps every value and secrets are never shown in full', async () => {
  const { home, root } = dirs();
  await run({ home, root, prompter: fakePrompter([...Object.values(answers), '', '', '']) });
  writeFileSync(join(home, 'report-template.md'), 'my format');
  const prompter = fakePrompter([]);
  await run({ home, root, prompter, keepPreferences: true });
  assert.equal(parseEnv(readFileSync(join(home, '.env'), 'utf8')).OP_API_KEY, 'op-secret-1234');
  const all = prompter.prompts.join('\n');
  assert.ok(!all.includes('op-secret-1234') && !all.includes('nc-secret-9876'), all);
  assert.match(all, /\*\*\*\*1234/);
  assert.match(all, /\[Backlog: Android POS\]/);
  assert.equal(prompter.prompts.length, FIELDS.length, 'keepPreferences skips the three questions');
  assert.equal(readFileSync(join(home, 'report-template.md'), 'utf8'), 'my format');
});

test('a required value left empty is asked again', async () => {
  const { home, root } = dirs();
  const prompter = fakePrompter(['', ...Object.values(answers), '', '', '']);
  await run({ home, root, prompter });
  assert.equal(parseEnv(readFileSync(join(home, '.env'), 'utf8')).OP_URL, 'https://op.example.com');
});

test('an existing repo .env is offered as starting values', async () => {
  const { home, root } = dirs();
  writeFileSync(join(root, '.env'), formatEnv(answers));
  const prompter = fakePrompter(['', ...FIELDS.map(() => ''), '', '', '']);
  await run({ home, root, prompter });
  assert.match(prompter.prompts[0], /Found existing settings in .*\.env\. Use them as starting values\? \[Y\/n\]/);
  assert.equal(parseEnv(readFileSync(join(home, '.env'), 'utf8')).NC_USER, 'ryan');
});

test('setup ends by printing the ask rules and returns the check result', async () => {
  const { home, root } = dirs();
  const lines = [];
  const code = await runSetup({
    home, root, log: (l) => lines.push(l), runCheck: async () => 1,
    prompter: fakePrompter([...Object.values(answers), '', '', '']),
  });
  assert.equal(code, 1);
  for (const rule of ASK_RULES) assert.ok(lines.some((l) => l.includes(rule)), rule);
});

test('copyIfMissing never overwrites', async () => {
  const { home, root } = dirs();
  const target = join(home, 't.md');
  assert.equal(await copyIfMissing(join(root, 'report-template.example.md'), target), true);
  writeFileSync(target, 'edited');
  assert.equal(await copyIfMissing(join(root, 'report-template.example.md'), target), false);
  assert.equal(readFileSync(target, 'utf8'), 'edited');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/setup.test.js`
Expected: FAIL with `Cannot find module '…/src/setup.js'`

- [ ] **Step 3: Implement `src/setup.js`**

```js
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from './config.js';
import { envFile, preferencesFile, reportTemplateFile } from './home.js';
import { askPreferences, loadPreferences, savePreferences } from './preferences.js';

export const FIELDS = [
  { key: 'OP_URL', label: 'OpenProject URL', hint: 'Browser address bar, e.g. https://openproject.example.com' },
  { key: 'OP_API_KEY', label: 'OpenProject API token', secret: true, hint: 'OpenProject → avatar → My account → Access tokens → API → + API token' },
  { key: 'OP_PROJECT', label: 'OpenProject project identifier', hint: 'The part after /projects/ in the project URL' },
  { key: 'OP_BACKLOG', label: 'Backlog version name', hint: 'OpenProject → project → Backlogs, e.g. Backlog: Android POS' },
  { key: 'NC_URL', label: 'Nextcloud URL', hint: 'Browser address bar, e.g. https://cloud.example.com' },
  { key: 'NC_USER', label: 'Nextcloud username', hint: 'Settings → Personal info (login name, not display name)' },
  { key: 'NC_APP_PASSWORD', label: 'Nextcloud app password', secret: true, hint: 'Settings → Security → Devices & sessions → Create new app password' },
  { key: 'NC_TALK_ROOM', label: 'Talk room token', hint: 'Open the room; the part after /call/ in the URL' },
];

export const ASK_RULES = ['Bash(node *opflow.js*--yes*)', 'PowerShell(node *opflow.js*--yes*)'];

export const maskSecret = (value) => `****${value.length > 4 ? value.slice(-4) : ''}`;

// parseEnv strips one matching pair of outer quotes, so double-quoting every value round-trips anything.
export function formatEnv(values) {
  const lines = FIELDS.map((f) => `${f.key}="${values[f.key] ?? ''}"`);
  return `# Written by opflow setup. Re-run setup to change these values.\n${lines.join('\n')}\n`;
}

export async function copyIfMissing(source, target) {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

async function readEnv(file) {
  try {
    return parseEnv(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function confirm(prompter, question) {
  const answer = ((await prompter.ask(question)) ?? '').trim().toLowerCase();
  return answer === '' || answer === 'y' || answer === 'yes';
}

async function startingValues(home, root, prompter, migrateFrom) {
  const current = await readEnv(envFile(home));
  if (current) return current;
  for (const file of [migrateFrom, join(root, '.env')].filter(Boolean)) {
    const found = await readEnv(file);
    if (found && (await confirm(prompter, `Found existing settings in ${file}. Use them as starting values? [Y/n]: `))) {
      return found;
    }
  }
  return {};
}

async function promptFields(prompter, current, log) {
  const values = {};
  for (const f of FIELDS) {
    log(`\n${f.label}: ${f.hint}`);
    for (;;) {
      const existing = current[f.key] ?? '';
      const shown = existing ? ` [${f.secret ? maskSecret(existing) : existing}]` : '';
      const ask = f.secret ? prompter.askSecret : prompter.ask;
      const value = ((await ask(`${f.label}${shown}: `)) ?? '').trim() || existing;
      if (value) {
        values[f.key] = f.key.endsWith('_URL') ? value.replace(/\/+$/, '') : value;
        break;
      }
      log(`  ${f.label} is required.`);
    }
  }
  return values;
}

export async function runSetup({ home, root, prompter, log, runCheck, keepPreferences = false, migrateFrom = null }) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  log(`opflow setup: your settings are saved in ${home}`);

  const values = await promptFields(prompter, await startingValues(home, root, prompter, migrateFrom), log);
  await writeFile(envFile(home), formatEnv(values), { mode: 0o600 });
  await chmod(envFile(home), 0o600);
  log(`\nSaved ${envFile(home)}`);

  const saved = await loadPreferences(preferencesFile(home));
  if (keepPreferences && saved) {
    log('Keeping your saved ticket-breakdown preferences.');
  } else {
    log('\nHow should /opflow:plan-feature break your work into tickets?');
    await savePreferences(preferencesFile(home), await askPreferences((q) => prompter.ask(q), log));
  }

  if (await copyIfMissing(join(root, 'report-template.example.md'), reportTemplateFile(home))) {
    log(`Created ${reportTemplateFile(home)} (edit it to change your /opflow:report-day format)`);
  }

  log('\nChecking access (read-only):');
  const code = await runCheck();
  log('\nRecommended: add both of these to "permissions.ask" in ~/.claude/settings.json so Claude Code');
  log('asks you again before any opflow write command runs:');
  for (const rule of ASK_RULES) log(`  "${rule}"`);
  return code;
}

// Terminal prompter; askSecret hides typed characters.
export function createTerminalPrompter(input, output) {
  const rl = createInterface({ input, output, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!muted) write(text);
  };
  return {
    ask: (question) => rl.question(question),
    async askSecret(question) {
      output.write(question);
      muted = true;
      try {
        return await rl.question('');
      } finally {
        muted = false;
        output.write('\n');
      }
    },
    close: () => rl.close(),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/setup.test.js`
Expected: all pass.

- [ ] **Step 5: Wire `setup` into `bin/opflow.js`**

Add this import (the existing `import { run, USAGE } from '../src/cli.js';` stays as it is):

```js
import { createTerminalPrompter, runSetup } from '../src/setup.js';
```

Replace the body of `setup()`:

```js
async function setup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`setup needs a terminal. Run it in your own terminal:\n  node "${self}" setup`);
    return 1;
  }
  const prompter = createTerminalPrompter(process.stdin, process.stdout);
  try {
    return await runSetup({
      home,
      root: fileURLToPath(new URL('..', import.meta.url)),
      prompter,
      log: (line) => console.log(line),
      runCheck: () => run(['check'], cliDeps(loadUserConfig(home))),
      keepPreferences: argv.includes('--keep-preferences'),
      migrateFrom: process.env.OPFLOW_MIGRATE_FROM || null,
    });
  } finally {
    prompter.close();
  }
}
```

- [ ] **Step 6: Run the full suite, then a manual terminal check**

Run: `npm test`
Expected: all pass.

Manual check (needs a real terminal):

```bash
OPFLOW_HOME=$(mktemp -d) node bin/opflow.js setup
```

Answer with dummy values. Confirm that:
- secrets are not echoed while typing;
- the three questions appear;
- `check` runs and prints FAIL lines for the dummy values;
- the ask rules are printed.

- [ ] **Step 7: Commit**

```bash
git add src/setup.js bin/opflow.js tests/setup.test.js
git commit -m "feat: interactive setup writes ~/.opflow config, preferences and report template"
```

---

### Task 4: Plugin packaging, plugin-path skills, reminder, remove the old installer

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`,
  `skills/setup/SKILL.md`, `tests/plugin.test.js`
- Replace: `skills/plan-feature/SKILL.md`, `skills/done-tasks/SKILL.md`, `skills/report-day/SKILL.md` (full
  contents below)
- Modify: `scripts/session-reminder.js`, `tests/session-reminder.test.js`, `package.json`
- Delete: `scripts/install.js`, `tests/install.test.js`

**Interfaces:**
- Consumes: `opflowHome`, `envFile` (Task 1); `isMainModule` (Task 1); the CLI commands `setup`, `plan:rules`
  (Tasks 2–3).
- Produces: `reminderText({ configured }): string`, `reminderOutput({ configured }): string`.

- [ ] **Step 1: Write the failing tests**

`tests/plugin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SKILLS = ['done-tasks', 'plan-feature', 'report-day', 'setup'];

test('plugin.json and marketplace.json describe the opflow plugin', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'opflow');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.version, JSON.parse(read('package.json')).version);
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.name, 'opflow');
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [['opflow', './']]);
});

test('hooks.json runs the existing session reminder on startup', () => {
  const entry = JSON.parse(read('hooks/hooks.json')).hooks.SessionStart[0];
  assert.equal(entry.matcher, 'startup');
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-reminder.js"');
  assert.ok(existsSync(join(ROOT, 'scripts/session-reminder.js')));
});

test('skills: user-only, quoted plugin-root CLI path, no install placeholders', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'skills')).sort(), SKILLS);
  for (const name of SKILLS) {
    const text = read(`skills/${name}/SKILL.md`);
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), name);
    assert.match(text, /\ndisable-model-invocation: true\r?\n/, name);
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, `${name}: leftover install placeholder`);
    for (const line of text.split('\n').filter((l) => l.includes('opflow.js'))) {
      assert.ok(line.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js"'), `${name}: unquoted or wrong path: ${line}`);
    }
  }
});

test('write skills keep the --yes approval guard; plan-feature fetches plan:rules', () => {
  for (const name of ['done-tasks', 'plan-feature', 'report-day']) {
    const text = read(`skills/${name}/SKILL.md`);
    assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/opflow\.js" .*--yes/, name);
    assert.match(text, /Never run a command with `--yes` without an explicit \*\*Approve\*\*/, name);
  }
  assert.match(read('skills/plan-feature/SKILL.md'), /opflow\.js" plan:rules/);
  assert.match(read('skills/report-day/SKILL.md'), /~\/\.opflow\/report-template\.md/);
});

test('the old installer is gone', () => {
  assert.equal(existsSync(join(ROOT, 'scripts/install.js')), false);
  assert.equal(JSON.parse(read('package.json')).scripts['install-skills'], undefined);
});
```

Replace `tests/session-reminder.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reminderOutput, reminderText } from '../scripts/session-reminder.js';

const SCRIPT = fileURLToPath(new URL('../scripts/session-reminder.js', import.meta.url));

test('reminderOutput hands the text to Claude as SessionStart context', () => {
  assert.deepEqual(JSON.parse(reminderOutput({ configured: true })), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reminderText({ configured: true }) },
  });
});

test('configured: names the namespaced commands, once, never run unasked', () => {
  const text = reminderText({ configured: true });
  for (const cmd of ['/opflow:plan-feature', '/opflow:done-tasks', '/opflow:report-day']) assert.ok(text.includes(cmd), cmd);
  assert.match(text, /once/);
  assert.match(text, /never run/i);
  assert.doesNotMatch(text, /\/opflow:setup/);
});

test('not configured: only points to /opflow:setup', () => {
  const text = reminderText({ configured: false });
  assert.match(text, /\/opflow:setup/);
  assert.doesNotMatch(text, /\/opflow:plan-feature/);
  assert.match(text, /never run/i);
});

test('the script checks ~/.opflow/.env to decide', () => {
  const home = mkdtempSync(join(tmpdir(), 'opflow-'));
  const env = { ...process.env, OPFLOW_HOME: home };
  const before = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }).stdout.trim();
  assert.equal(before, reminderOutput({ configured: false }));
  writeFileSync(join(home, '.env'), 'OP_URL=x');
  const after = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }).stdout.trim();
  assert.equal(after, reminderOutput({ configured: true }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/plugin.test.js tests/session-reminder.test.js`
Expected: FAIL (`.claude-plugin/plugin.json` missing; `reminderText` not exported).

- [ ] **Step 3: Plugin files**

Bump `package.json` to `"version": "0.2.0"` and delete the `"install-skills"` line from `scripts`.

`.claude-plugin/plugin.json`:

```json
{
  "name": "opflow",
  "version": "0.2.0",
  "description": "Tickets + daily reports: plan work into OpenProject sprints by points and post end-of-day reports to Nextcloud Talk, always after your approval.",
  "author": { "name": "ry-apollotech" }
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "opflow",
  "owner": { "name": "ry-apollotech" },
  "plugins": [
    {
      "name": "opflow",
      "source": "./",
      "description": "Tickets + daily reports for OpenProject and Nextcloud Talk."
    }
  ]
}
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-reminder.js\"" }]
      }
    ]
  }
}
```

- [ ] **Step 4: Session reminder**

`scripts/session-reminder.js`:

```js
// SessionStart hook: reminds Claude that the opflow skills exist without ever running them.
import { existsSync } from 'node:fs';
import { envFile, opflowHome } from '../src/home.js';
import { isMainModule } from '../src/main-module.js';

const NEVER = 'Never run opflow commands or the opflow CLI unless the user types the command themselves.';

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

export function reminderOutput({ configured }) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reminderText({ configured }) } });
}

if (isMainModule(process.argv[1], import.meta.url)) {
  console.log(reminderOutput({ configured: existsSync(envFile(opflowHome())) }));
}
```

- [ ] **Step 5: Skills**

`skills/setup/SKILL.md`:

````markdown
---
name: setup
description: Connect opflow to the user's own OpenProject and Nextcloud accounts. Use when the user runs /opflow:setup.
disable-model-invocation: true
---

# Set up opflow

1. Tell the user that setup asks for these values in their own terminal, and where to find each:

   | Value | Where to get it |
   |---|---|
   | OpenProject URL | Browser address bar, e.g. `https://openproject.example.com` |
   | OpenProject API token | OpenProject → avatar → **My account** → **Access tokens** → **API** → **+ API token** |
   | Project identifier | The part after `/projects/` in the project URL |
   | Backlog version name | OpenProject → project → **Backlogs**, e.g. `Backlog: Android POS` |
   | Nextcloud URL | Browser address bar, e.g. `https://cloud.example.com` |
   | Nextcloud username | **Settings** → **Personal info** (login name) |
   | Nextcloud app password | **Settings** → **Security** → **Devices & sessions** → **Create new app password** |
   | Talk room token | Open the room; the part after `/call/` in the URL |

   It then asks three questions about how tickets are broken down, and creates their report template.
2. Tell them **not to paste tokens or passwords into this chat**, and to run this in their own terminal (not with `!` here, because it needs a real terminal to hide what they type):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" setup
   ```

   Re-running it later keeps current values when they press Enter. Add `--keep-preferences` to skip the three questions.
3. When they say it's done, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" check
   ```

   If every line starts with `OK`, tell them they can use `/opflow:plan-feature`, `/opflow:done-tasks` and `/opflow:report-day`. For any `FAIL` line, explain the likely cause from the error text and ask them to re-run setup.

Never ask for, repeat, or write credentials yourself.
````

`skills/plan-feature/SKILL.md`:

````markdown
---
name: plan-feature
description: Break a feature into OpenProject User Stories and create them only after the user approves. Use when the user runs /opflow:plan-feature.
disable-model-invocation: true
---

# Plan a feature into OpenProject

1. Understand the feature from the user's request and, if relevant, the current codebase. Ask one clarifying question only if the scope is genuinely unclear.
2. Get the user's ticket-breakdown rules:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" plan:rules
   ```

   Break the feature into User Stories, in priority order (most important first), following those rules exactly. Each story has:
   - `subject`: imperative, at most 80 characters
   - `description`: Markdown — 1–3 sentences of context, then `**Acceptance criteria**` as a `- [ ]` checklist
   - `points`: `1` (≈2h), `2` (≈4h) or `4` (≈1 day). Split any story bigger than a day.
3. Write the stories as a JSON array of `{ "subject": "...", "description": "...", "points": N }` to `~/.opflow/tasks.json` and run the dry run (it creates nothing):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:create --file ~/.opflow/tasks.json
   ```

   The dry run finds the current sprint (the open `Sprint <N>` version), counts your open work already in it, and fills the sprint up to 60 points in priority order; stories that don't fit go to the backlog version. If writing the file fails or the dry run prints `Error:`, stop and tell the user — never run the `--yes` command. If it says opflow is not set up, tell the user to run `/opflow:setup`.
4. Show them as a numbered table (`# | Subject | Points | Goes to | Acceptance criteria`) followed by the dry run's sprint total line, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
   - **Edit** → apply the changes, rewrite `tasks.json`, re-run the dry run, show the full table again, ask again.
   - **Cancel** → stop. Nothing is created.
   Only after **Approve**, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:create --file ~/.opflow/tasks.json --yes
   ```
5. Show the created `#id subject -> version` lines. If the command reports `FAILED`, tell the user which were created and which were not, and offer to retry only the missing ones (rewrite `tasks.json` with just those and ask for approval again).

Never run a command with `--yes` without an explicit **Approve** from the user for that exact list in this conversation.
````

`skills/done-tasks/SKILL.md`:

````markdown
---
name: done-tasks
description: Propose which of today's OpenProject User Stories are finished and set them to Closed only after the user approves. Use when the user runs /opflow:done-tasks.
disable-model-invocation: true
---

# Close finished OpenProject tasks

1. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:today --json
   ```
   If the user named specific work package ids, use those instead. If it says opflow is not set up, tell the user to run `/opflow:setup`.
2. From the work done in this conversation, decide which open (not `Closed`) items are actually finished. Only propose items whose acceptance criteria were met.
3. Show the proposal as a list (`#id subject — why it's done`), then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:done <id> <id> ... --yes
   ```
5. Show the result lines. Report any `FAILED` lines verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for those exact ids in this conversation.
````

`skills/report-day/SKILL.md`:

````markdown
---
name: report-day
description: Draft an end-of-day report from today's OpenProject activity and post it to Nextcloud Talk only after the user approves. Use when the user runs /opflow:report-day.
disable-model-invocation: true
---

# End-of-day report to Nextcloud Talk

1. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" op:today --json
   ```
   If it says opflow is not set up, tell the user to run `/opflow:setup` and stop.
2. Read the user's report template at `~/.opflow/report-template.md`. If it's missing, tell the user to run `/opflow:setup`, and stop. Draft the report by filling in that template:
   - Keep its sections, their order and its wording, and replace example lines like `#id Subject` with real items.
   - Replace `{{date}}` with today's date (YYYY-MM-DD).
   - Follow the instructions in `<!-- ... -->` comments, then leave every comment out of the report.
   - Unless the template says otherwise: **Done** = status `Closed`; **In progress** = every other status; add short notes from this conversation's work where they help.
   - If the template needs something you don't know, such as blockers or tomorrow's plan, ask the user in one question before drafting.
3. Show the exact final text, then ask with AskUserQuestion: **Approve**, **Edit**, **Cancel**.
4. Only after **Approve**, write the text to `~/.opflow/report.md`. If writing the file fails for any reason, stop and tell the user — never run the `--yes` command. Otherwise run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/opflow.js" talk:post --file ~/.opflow/report.md --yes
   ```
5. Confirm the posted message id, or show the error verbatim.

Never run a command with `--yes` without an explicit **Approve** from the user for that exact text in this conversation.
````

Note: `{{date}}` is lowercase, so the placeholder test (`\{\{[A-Z_]+\}\}`) does not flag it.

- [ ] **Step 6: Remove the old installer**

```bash
git rm scripts/install.js tests/install.test.js
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass. `grep -rn "install-skills\|{{OPFLOW}}\|{{DATA_DIR}}\|{{PLAN_RULES}}\|{{REPORT_TEMPLATE}}" src scripts skills bin tests`
prints nothing.

- [ ] **Step 8: Validate and try the plugin locally**

Run:

```bash
claude plugin validate .
claude plugin marketplace add "$(pwd)"
claude plugin install opflow@opflow
```

Expected: validation passes, and the install succeeds. In a new Claude Code session, `/opflow:setup`,
`/opflow:plan-feature`, `/opflow:done-tasks` and `/opflow:report-day` appear. The first reply ends with the setup
reminder if `~/.opflow/.env` doesn't exist yet. If `claude plugin validate` is not available in the installed
version, skip it and rely on the install result.

- [ ] **Step 9: Commit**

```bash
git add -A .claude-plugin hooks skills scripts tests package.json
git commit -m "feat: package opflow as a Claude Code plugin"
```

---

### Task 5: Documentation

**Files:**
- Replace: `README.md`
- Modify: `DOCUMENTATION.md`

- [ ] **Step 1: Rewrite `README.md`** with these sections, in this order, carrying over the existing wording
  where it still applies:

1. **Title and summary.** `# opflow — Tickets + daily reports for Claude Code`, then two sentences: plan work into
   OpenProject sprints by points and post daily reports to Nextcloud Talk, always after your approval. Everyone
   uses their own accounts.
2. **Install:**

   ```
   /plugin marketplace add <owner>/opflow
   /plugin install opflow@opflow
   /opflow:setup
   ```

   Then: "The repo is private: your git must already be able to clone it (e.g. `gh auth login`). Needs Node.js 18+."
3. **What setup asks for:** the 8-row table from the current README (the "What you need (per dev)" table), with
   the `.env key` column removed. Then: "Setup runs in your own terminal and hides what you type for the token
   and password. Settings are saved in `~/.opflow/` and survive plugin updates. Re-run
   `/opflow:setup` any time; Enter keeps current values." Keep the "Your accounts also need" bullets.
4. **Recommended: approval rules.** The existing step-5 JSON block, unchanged.
5. **Daily use:** the existing section with commands renamed to `/opflow:plan-feature`, `/opflow:done-tasks`,
   `/opflow:report-day`. Keep "How points and sprints work" and "Your report format". Change paths to
   `~/.opflow/report-template.md`. To reset: delete it and re-run `/opflow:setup`.
6. **Ticket breakdown:** the three questions (the table from DOCUMENTATION.md §3.4), then: "Change them with
   `/opflow:setup` (or `node …/opflow.js setup`); add `--keep-preferences` to keep them while changing
   credentials."
7. **Updating:** `/plugin update opflow`, or enable auto-update in `/plugin`. Your `~/.opflow/` is never touched.
8. **APIs this uses:** the existing table, unchanged.
9. **CLI:** the existing block plus `setup [--keep-preferences]` and `plan:rules`. Replace `node bin/opflow.js`
   with `node "<plugin folder>/bin/opflow.js"`.
10. **Troubleshooting:** the existing table, plus these rows:
    - `opflow is not set up` → run `/opflow:setup`.
    - `setup needs a terminal` → copy the printed command into your own terminal.
    - `/opflow:… commands missing` → `/plugin` → check that opflow is installed and enabled, then restart
      Claude Code.
11. **Developing opflow:** clone, `npm test`, try local changes with
    `claude plugin marketplace add <clone path>`, bump `version` in both `package.json` and
    `.claude-plugin/plugin.json` for each release.

- [ ] **Step 2: Update `DOCUMENTATION.md`**
- §1 table: the "Claude Code skills" row becomes "Claude Code plugin (`/opflow:setup`, `/opflow:plan-feature`,
  `/opflow:done-tasks`, `/opflow:report-day` + a session reminder hook) | `.claude-plugin/`, `skills/`,
  `hooks/`".
- §3 Setup: replace 3.1 (`.env`), 3.4 (install skills), 3.5 and 3.6 with:
  - **3.1 Install the plugin:** the three commands.
  - **3.2 Run setup:** the table, `~/.opflow/` contents (the per-user folder table from the spec), and
    `OPFLOW_HOME`.
  - **3.3 Approval rules:** the existing JSON.

  Keep "Enable the User Story type" and "Verify access".
- Rename every `/plan-feature`, `/done-tasks`, `/report-day` to the `/opflow:` form. Replace every
  `.opflow/tasks.json` with `~/.opflow/tasks.json`. Replace `npm run install-skills` with `/opflow:setup` wherever
  it remains.
- File layout block: add `.claude-plugin/`, `hooks/hooks.json`, `src/home.js`, `src/setup.js`,
  `src/preferences.js`, `src/main-module.js`. Remove `scripts/install.js`. Replace the `.env` / `.opflow/` /
  `report-template.md` lines with `~/.opflow/  your settings, preferences, report template, working files`.

- [ ] **Step 3: Check for stale references**

Run: `grep -n "install-skills\|bin/opflow.js check\|\.env\.example\|/plan-feature\b" README.md DOCUMENTATION.md | grep -v "opflow:"`
Expected: no lines, except `.env.example` if it's still mentioned as the developer reference. Also delete
`.env.example`, since setup replaces it, and remove it from any doc that mentions it.

- [ ] **Step 4: Commit**

```bash
git add README.md DOCUMENTATION.md .env.example
git commit -m "docs: install and use opflow as a Claude Code plugin"
```

---

### Task 6: Publish and migrate Ryan's install (interactive, confirm each step)

No code. Each step changes something outside the repo, so **ask Ryan before each one**.

- [ ] **Step 1: Migrate Ryan's config.** Ryan runs in his own terminal:

```bash
node /mnt/c/Users/Ryan/Documents/OpenProject/bin/opflow.js setup
```

It offers the repo `.env` as starting values; Ryan presses Enter through the values and answers the three
questions. Then confirm `node bin/opflow.js check` prints all `OK`.

- [ ] **Step 2: Move Ryan's report template if he edited it.** If
`/mnt/c/Users/Ryan/Documents/OpenProject/report-template.md` differs from the example, copy it over
`~/.opflow/report-template.md` (after asking).

- [ ] **Step 3: Remove the old user-level install (after asking).**
  - Delete `~/.claude/skills/plan-feature`, `~/.claude/skills/done-tasks` and `~/.claude/skills/report-day`.
  - Remove the `SessionStart` entry whose command contains `scripts/session-reminder.js` from
    `~/.claude/settings.json`. Back the file up first and keep every other hook.

- [ ] **Step 4: Install from the local folder.** `claude plugin marketplace add
/mnt/c/Users/Ryan/Documents/OpenProject`, then `claude plugin install opflow@opflow`. Restart Claude Code, then
check that the four `/opflow:` commands appear and the first reply ends with the reminder line.

- [ ] **Step 5: Create the GitHub repo and push, once Ryan confirms the owner.** Only if Ryan confirms the
owner (org or account) and that it should be private:

```bash
gh repo create <owner>/opflow --private --source . --remote origin --push
```

Then replace `<owner>` in `README.md` and commit. Teammates can then install with
`/plugin marketplace add <owner>/opflow`.

- [ ] **Step 6: Delete the leftover repo files.** Ask Ryan to delete `.env`, `report-template.md`, `.opflow/`
and `.dfly/` from the repo folder. They are git-ignored and no longer used. Deleting them is Ryan's call; the
safety hook blocks Claude from deleting them.
