import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASK_RULES, isMainModule, renderSkill, sessionStartHook, skillDirNames, SKILLS_DIR } from '../scripts/install.js';

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function innerGlob(rule) {
  const m = rule.match(/^(?:Bash|PowerShell)\((.*)\)$/);
  assert.ok(m, `rule "${rule}" should be wrapped in Bash(...) or PowerShell(...)`);
  return m[1];
}

test('renderSkill replaces every placeholder', () => {
  const out = renderSkill('node "{{OPFLOW}}" x --file "{{DATA_DIR}}/a" "{{DATA_DIR}}/b"', {
    opflow: 'C:/repo/bin/opflow.js',
    dataDir: 'C:/repo/.opflow',
  });
  assert.equal(out, 'node "C:/repo/bin/opflow.js" x --file "C:/repo/.opflow/a" "C:/repo/.opflow/b"');
});

test('every skill template has frontmatter, a --yes command, and an approval guard', () => {
  const names = readdirSync(SKILLS_DIR);
  assert.deepEqual(names.sort(), ['done-tasks', 'plan-feature', 'report-day']);
  for (const name of names) {
    const text = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), name);
    assert.match(text, /^---[\s\S]*?\ndisable-model-invocation: true\r?\n[\s\S]*?---/, `${name}: only runs when the user types it`);
    assert.match(text, /node "\{\{OPFLOW\}\}" .*--yes/, name);
    assert.match(text, /Never run a command with `--yes` without an explicit \*\*Approve\*\*/, name);
  }
});

test('ASK_RULES cover both Bash and PowerShell', () => {
  assert.deepEqual(ASK_RULES, ['Bash(node *opflow.js*--yes*)', 'PowerShell(node *opflow.js*--yes*)']);
});

test('every rendered --yes command line matches every ASK_RULES pattern', () => {
  const opflow = 'C:/repo/bin/opflow.js';
  const dataDir = 'C:/repo/.opflow';
  const regexes = ASK_RULES.map((rule) => globToRegExp(innerGlob(rule)));
  const names = readdirSync(SKILLS_DIR);

  let checked = 0;
  for (const name of names) {
    const template = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const rendered = renderSkill(template, { opflow, dataDir });
    const yesLines = rendered.split(/\r?\n/).filter((line) => line.includes('node "') && line.includes('--yes'));
    assert.ok(yesLines.length > 0, `${name}: expected at least one rendered --yes command line`);
    for (const line of yesLines) {
      const trimmed = line.trim();
      for (const re of regexes) {
        assert.match(trimmed, re, `${name}: "${trimmed}" should match ${re}`);
      }
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('skillDirNames keeps only directory entries', () => {
  const entries = [
    { name: 'plan-feature', isDirectory: () => true },
    { name: 'done-tasks', isDirectory: () => true },
    { name: '.DS_Store', isDirectory: () => false },
    { name: 'notes.txt', isDirectory: () => false },
  ];
  assert.deepEqual(skillDirNames(entries), ['plan-feature', 'done-tasks']);
});

test('isMainModule compares case-insensitively on win32 and case-sensitively elsewhere', () => {
  const url = 'file:///C:/repo/scripts/install.js';
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'win32'), true);
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'linux'), false);
  assert.equal(isMainModule('C:/repo/scripts/install.js', url, 'linux'), true);
  assert.equal(isMainModule(undefined, url, 'win32'), false);
});

test('sessionStartHook runs the reminder script on new sessions only', () => {
  assert.deepEqual(sessionStartHook('C:/repo/scripts/session-reminder.js'), {
    matcher: 'startup',
    hooks: [{ type: 'command', command: 'node "C:/repo/scripts/session-reminder.js"' }],
  });
});
