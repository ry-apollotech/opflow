import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULTS,
  QUESTIONS,
  askPreferences,
  loadPreferences,
  normalizePreferences,
  planRules,
  savePreferences,
} from '../src/preferences.js';

test('there are three questions and each default is one of its options', () => {
  assert.deepEqual(QUESTIONS.map((q) => q.key), ['testing', 'size', 'docs']);
  for (const q of QUESTIONS) assert.ok(q.options.some((o) => o.value === DEFAULTS[q.key]), q.key);
  assert.deepEqual(DEFAULTS, { testing: 'criteria', size: 'balanced', docs: 'criteria' });
});

test('normalizePreferences keeps valid answers and defaults the rest', () => {
  assert.deepEqual(normalizePreferences({ testing: 'excluded', size: 'huge' }), { ...DEFAULTS, testing: 'excluded' });
  assert.deepEqual(normalizePreferences(null), DEFAULTS);
});

test('planRules always has the PM-facing rules', () => {
  const rules = planRules(DEFAULTS);
  assert.match(rules, /one outcome a project manager can check or demo/);
  assert.match(rules, /Never create a story for code review or refactoring on its own/);
  assert.match(rules, /merge stories/);
});

test('planRules follows the size answer', () => {
  assert.match(planRules(DEFAULTS), /Never more than 8 stories/);
  assert.match(planRules({ ...DEFAULTS, size: 'fewer' }), /Never more than 5 stories/);
  const detailed = planRules({ ...DEFAULTS, size: 'detailed' });
  assert.match(detailed, /Never more than 10 stories/);
  assert.match(detailed, /Technical tasks .* may be their own stories/);
});

test('planRules follows the testing and docs answers', () => {
  assert.match(planRules(DEFAULTS), /Testing: add it as an acceptance criterion/);
  assert.match(planRules({ ...DEFAULTS, testing: 'excluded' }), /Testing: don't mention it/);
  assert.match(planRules({ ...DEFAULTS, testing: 'separate' }), /Testing: add one separate story/);
  assert.match(planRules({ ...DEFAULTS, docs: 'excluded' }), /Docs and deployment: don't mention them/);
  assert.match(planRules({ ...DEFAULTS, docs: 'separate' }), /Docs and deployment: add separate stories/);
});

test('askPreferences maps numbers to options and Enter to the default', async () => {
  const answers = ['2', '', '3'];
  const prompts = [];
  const prefs = await askPreferences(async (prompt) => {
    prompts.push(prompt);
    return answers.shift();
  });
  assert.deepEqual(prefs, { testing: 'excluded', size: 'balanced', docs: 'separate' });
  assert.equal(prompts.length, 3);
});

test('askPreferences asks again after an invalid answer', async () => {
  const answers = ['9', 'x', '3', '', ''];
  const prefs = await askPreferences(async () => answers.shift());
  assert.equal(prefs.testing, 'separate');
});

test('saved preferences load back; a missing or broken file loads as null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opflow-'));
  const file = join(dir, 'preferences.json');
  assert.equal(await loadPreferences(file), null);
  await savePreferences(file, { ...DEFAULTS, size: 'fewer' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...DEFAULTS, size: 'fewer' });
  assert.deepEqual(await loadPreferences(file), { ...DEFAULTS, size: 'fewer' });
  writeFileSync(file, '{not json');
  assert.equal(await loadPreferences(file), null);
});
