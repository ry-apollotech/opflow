import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, parseArgs, USAGE } from '../src/cli.js';

function setup({ files = {}, op: opOverrides = {}, talk: talkOverrides = {} } = {}) {
  const calls = [];
  const lines = [];
  const removedFiles = [];
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
    removeFile: async (path) => { removedFiles.push(path); },
    today: '2026-09-22',
  };
  return { deps, calls, lines, removedFiles, output: () => lines.join('\n') };
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
  assert.equal(s.output(), '#101 A\n#102 B\nRemoved t.json.');
});

test('op:create --yes removes the input file after a fully successful write', async () => {
  const s = setup({ files: tasksFile });
  assert.equal(await run(['op:create', '--file', 't.json', '--yes'], s.deps), 0);
  assert.deepEqual(s.removedFiles, ['t.json']);
});

test('op:create without --yes does not remove the input file', async () => {
  const s = setup({ files: tasksFile });
  assert.equal(await run(['op:create', '--file', 't.json'], s.deps), 0);
  assert.deepEqual(s.removedFiles, []);
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
  assert.deepEqual(s.removedFiles, []);
});

test('op:create strips a UTF-8 BOM before parsing JSON', async () => {
  const s = setup({ files: { 't.json': '﻿' + JSON.stringify([{ subject: 'A' }]) } });
  assert.equal(await run(['op:create', '--file', 't.json', '--yes'], s.deps), 0);
  assert.deepEqual(s.calls, [['create', 'A', { typeId: 7, assigneeId: 3 }]]);
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
  assert.deepEqual(s.removedFiles, []);
});

test('talk:post --yes posts the trimmed message', async () => {
  const s = setup({ files: { 'r.md': '\nHello team\n' } });
  assert.equal(await run(['talk:post', '--file', 'r.md', '--yes'], s.deps), 0);
  assert.deepEqual(s.calls, [['post', 'Hello team']]);
  assert.equal(s.output(), 'Posted to Talk (message id 42).\nRemoved r.md.');
});

test('talk:post --yes removes the input file after posting', async () => {
  const s = setup({ files: { 'r.md': '\nHello team\n' } });
  assert.equal(await run(['talk:post', '--file', 'r.md', '--yes'], s.deps), 0);
  assert.deepEqual(s.removedFiles, ['r.md']);
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
