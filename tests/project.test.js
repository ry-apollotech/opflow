import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectsFile } from '../src/home.js';
import { identifyProject, loadProjects, projectBySlug, projectRoot, setOpProject, slugFor, toPosix } from '../src/project.js';
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
