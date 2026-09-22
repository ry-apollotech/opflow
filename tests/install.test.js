import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSkill, SKILLS_DIR } from '../scripts/install.js';

test('renderSkill replaces every placeholder', () => {
  const out = renderSkill('node "{{DFLY}}" x --file "{{DATA_DIR}}/a" "{{DATA_DIR}}/b"', {
    dfly: 'C:/repo/bin/dfly.js',
    dataDir: 'C:/repo/.dfly',
  });
  assert.equal(out, 'node "C:/repo/bin/dfly.js" x --file "C:/repo/.dfly/a" "C:/repo/.dfly/b"');
});

test('every skill template has frontmatter, a --yes command, and an approval guard', () => {
  const names = readdirSync(SKILLS_DIR);
  assert.deepEqual(names.sort(), ['done-tasks', 'plan-feature', 'report-day']);
  for (const name of names) {
    const text = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), name);
    assert.match(text, /node "\{\{DFLY\}\}" .*--yes/, name);
    assert.match(text, /Never run a command with `--yes` without an explicit \*\*Approve\*\*/, name);
  }
});
