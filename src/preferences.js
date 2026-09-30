// How /plan-feature breaks work into stories. Asked once at install, saved per dev.
import { readFile, writeFile } from 'node:fs/promises';

export const QUESTIONS = [
  {
    key: 'testing',
    question: 'Unit tests / testing work',
    options: [
      { value: 'criteria', label: 'In acceptance criteria', hint: 'e.g. "- [ ] Unit tests cover the export", no separate ticket' },
      { value: 'excluded', label: 'Excluded', hint: 'never mentioned in tickets' },
      { value: 'separate', label: 'Separate ticket', hint: 'one testing ticket per feature' },
    ],
  },
  {
    key: 'size',
    question: 'Ticket size',
    options: [
      { value: 'balanced', label: 'Balanced', hint: 'one PM-checkable outcome per ticket, mostly 2-4 pts, max 8' },
      { value: 'fewer', label: 'Fewer, bigger', hint: 'feature-level outcomes only, mostly 4 pts, max 5' },
      { value: 'detailed', label: 'Detailed', hint: 'smaller 1-2 pt tickets, technical tasks allowed, max 10' },
    ],
  },
  {
    key: 'docs',
    question: 'Docs and deployment work',
    options: [
      { value: 'criteria', label: 'In acceptance criteria', hint: 'no separate ticket' },
      { value: 'excluded', label: 'Excluded', hint: 'never mentioned in tickets' },
      { value: 'separate', label: 'Separate tickets', hint: 'their own tickets when there is real work' },
    ],
  },
];

export const DEFAULTS = Object.fromEntries(QUESTIONS.map((q) => [q.key, q.options[0].value]));

export function normalizePreferences(value) {
  return Object.fromEntries(
    QUESTIONS.map((q) => [q.key, q.options.some((o) => o.value === value?.[q.key]) ? value[q.key] : DEFAULTS[q.key]]),
  );
}

const SIZE_RULES = {
  balanced: [
    'Scale the number of stories to the effort: under half a day → 1 story; 1–3 days → 2–4; a week or more → 4–8.',
    'Never more than 8 stories. If the work is bigger, propose phases and ask which phase to plan now.',
    'Aim for 2–4 points per story; use 1 point only for something deliverable on its own. Split by outcome, never by layer (no separate "backend" and "frontend" stories for one feature).',
  ],
  fewer: [
    'Only feature-level outcomes, mostly 4 points each: under a day → 1 story; otherwise 2–5.',
    'Never more than 5 stories. If the work is bigger, propose phases and ask which phase to plan now.',
  ],
  detailed: [
    'Smaller stories of 1–2 points (4 only if it cannot be split): under half a day → 1–2 stories; 1–3 days → 3–6; a week → 6–10.',
    'Technical tasks (e.g. set up a migration, add an API endpoint) may be their own stories.',
    'Never more than 10 stories. If the work is bigger, propose phases and ask which phase to plan now.',
  ],
};

const TESTING_RULES = {
  criteria: 'Testing: add it as an acceptance criterion (e.g. `- [ ] Unit tests cover …`); no separate testing stories.',
  excluded: "Testing: don't mention it in stories or acceptance criteria.",
  separate: 'Testing: add one separate story per feature (1–2 points) for the tests of the other stories.',
};

const DOCS_RULES = {
  criteria: 'Docs and deployment: add them as acceptance criteria where needed; no separate stories.',
  excluded: "Docs and deployment: don't mention them in stories or acceptance criteria.",
  separate: 'Docs and deployment: add separate stories for them when there is real work to do.',
};

export function planRules(prefs) {
  const p = normalizePreferences(prefs);
  return [
    'Each story is one outcome a project manager can check or demo. The subject says, in plain language, what changes for the user or the business.',
    ...SIZE_RULES[p.size],
    TESTING_RULES[p.testing],
    DOCS_RULES[p.docs],
    'Never create a story for code review or refactoring on its own.',
    'Before showing the table: merge stories a project manager would not track separately, split any story that hides two unrelated outcomes, and drop pure implementation steps.',
  ]
    .map((rule) => `- ${rule}`)
    .join('\n');
}

// ask(prompt) returns the typed line; Enter picks the default, a number picks that option.
export async function askPreferences(ask, log = () => {}) {
  const prefs = {};
  for (const [i, q] of QUESTIONS.entries()) {
    log(`\n${i + 1}/${QUESTIONS.length}  ${q.question}`);
    q.options.forEach((o, n) => log(`  ${n + 1}) ${o.label}${n === 0 ? ' (default)' : ''} - ${o.hint}`));
    for (;;) {
      const answer = ((await ask(`Choose 1-${q.options.length} [1]: `)) ?? '').trim();
      const n = answer === '' ? 1 : Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
        prefs[q.key] = q.options[n - 1].value;
        break;
      }
      log(`  Please type a number from 1 to ${q.options.length}, or press Enter for the default.`);
    }
  }
  return prefs;
}

export async function loadPreferences(file) {
  try {
    return normalizePreferences(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function savePreferences(file, prefs) {
  await writeFile(file, `${JSON.stringify(normalizePreferences(prefs), null, 2)}\n`);
}
