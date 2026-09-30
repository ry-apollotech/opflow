import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { parseEnv } from '../src/config.js';
import { DEFAULTS } from '../src/preferences.js';
import { ASK_RULES, FIELDS, copyIfMissing, createTerminalPrompter, formatEnv, maskSecret, runSetup } from '../src/setup.js';

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

test('createTerminalPrompter echoes normal answers but never secret ones', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (d) => { shown += d; });
  const prompter = createTerminalPrompter(input, output);
  const name = prompter.ask('Name: ');
  input.write('bob\n');
  assert.equal(await name, 'bob');
  const secret = prompter.askSecret('Token: ');
  input.write('hunter2\n');
  assert.equal(await secret, 'hunter2');
  prompter.close();
  assert.match(shown, /Name: .*bob/s);
  assert.match(shown, /Token: /);
  assert.ok(!shown.includes('hunter2'), shown);
});
