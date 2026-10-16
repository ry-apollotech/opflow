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

test('hooks.json runs the journal hook on every session start, Bash/PowerShell use and session end', () => {
  const { hooks } = JSON.parse(read('hooks/hooks.json'));
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-hook.js"';
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionEnd', 'SessionStart']);
  assert.equal(hooks.SessionStart[0].matcher, undefined, 'all SessionStart sources');
  assert.equal(hooks.PostToolUse[0].matcher, 'Bash|PowerShell');
  for (const name of Object.keys(hooks)) assert.equal(hooks[name][0].hooks[0].command, command, name);
  assert.ok(existsSync(join(ROOT, 'scripts/journal-hook.js')));
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

test('done-tasks reconciles from the journal and keeps the old flow as a fallback', () => {
  const text = read('skills/done-tasks/SKILL.md');
  for (const cmd of ['reconcile:candidates', 'project:map', 'reconcile:apply --file ~/.opflow/reconcile.json', 'op:today --json']) {
    assert.ok(text.includes(cmd), cmd);
  }
  assert.match(text, /opflow\.js" reconcile:apply --file ~\/\.opflow\/reconcile\.json --yes/);
  assert.match(text, /Never close.*without a `commit`/);
});
