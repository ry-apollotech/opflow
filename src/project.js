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
