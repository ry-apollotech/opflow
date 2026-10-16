import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
