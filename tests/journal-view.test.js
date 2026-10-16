import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_LIMIT, itemLine, renderDay, sessionContext } from '../src/journal-view.js';

const item = (over) => ({ kind: 'feature', status: 'done', text: 'Add CSV export', ...over });
const CLI = 'node "/p/bin/opflow.js"';
const base = { slug: 'tdm', session: 'abc', todayItems: [], previous: null, otherOpen: 0, cli: CLI };

test('itemLine shows status, commit evidence and ticket', () => {
  assert.equal(itemLine(item({ commit: '0123456789abcdef', ticket: '123' })), '- Add CSV export [done] (commit 0123456) #123');
  assert.equal(itemLine(item({ status: 'partial' })), '- Add CSV export [partial] (not committed)');
});

test('renderDay: Features then Bugs fixed, empty sections left out', () => {
  assert.equal(
    renderDay('tdm', [item({ kind: 'bug', text: 'Fix rounding', commit: 'aaaaaaa1' }), item({ commit: 'bbbbbbb2' })]),
    '## tdm\n\n**Features**\n- Add CSV export [done] (commit bbbbbbb)\n\n**Bugs fixed**\n- Fix rounding [done] (commit aaaaaaa)',
  );
  assert.equal(renderDay('tdm', [item({ kind: 'bug', text: 'B' })]), '## tdm\n\n**Bugs fixed**\n- B [done] (not committed)');
});

test('sessionContext: always explains how to note, with the session id', () => {
  const text = sessionContext(base);
  assert.match(text, /opflow journal — project "tdm", session abc\./);
  assert.ok(text.includes(`${CLI} journal:note --session abc --kind feature|bug --status done|partial --text "<one line>" [--ticket <id>]`));
  assert.doesNotMatch(text, /Recorded today|Unfinished/);
});

test('sessionContext: today, unfinished items from the previous day, sessions without an end', () => {
  const text = sessionContext({
    ...base,
    todayItems: [item({ commit: 'c0ffee00' })],
    previous: { date: '2026-10-15', items: [item({ text: 'Done earlier', commit: 'x' }), item({ kind: 'bug', status: 'partial', text: 'Refund rounding' })] },
    otherOpen: 1,
  });
  assert.match(text, /Recorded today:\n- Add CSV export \[done\] \(commit c0ffee0\)/);
  assert.match(text, /Unfinished from 2026-10-15:\n- Refund rounding \[partial\] \(not committed\)/);
  assert.doesNotMatch(text, /Done earlier/);
  assert.match(text, /1 other session\(s\) today have no recorded end/);
});

test('sessionContext: history is capped and points to journal:show', () => {
  const many = Array.from({ length: 30 }, (_, i) => item({ text: `Item ${i}` }));
  const lines = sessionContext({ ...base, todayItems: many }).split('\n');
  const history = lines.slice(1, lines.findIndex((l) => l.startsWith('When you finish')));
  assert.equal(history.length, CONTEXT_LIMIT);
  assert.match(history.at(-1), /more lines: node "\/p\/bin\/opflow\.js" journal:show --project tdm$/);
});
