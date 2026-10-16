import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveProjects } from '../src/project.js';

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
