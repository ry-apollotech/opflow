export const CONTEXT_LIMIT = 20;
const SECTIONS = [['feature', 'Features'], ['bug', 'Bugs fixed']];

export function itemLine({ text, status, commit, ticket }) {
  const evidence = commit ? `commit ${commit.slice(0, 7)}` : 'not committed';
  return `- ${text} [${status}] (${evidence})${ticket ? ` #${ticket}` : ''}`;
}

export function renderDay(slug, items) {
  const lines = [`## ${slug}`];
  for (const [kind, title] of SECTIONS) {
    const list = items.filter((i) => i.kind === kind);
    if (list.length) lines.push('', `**${title}**`, ...list.map(itemLine));
  }
  return lines.join('\n');
}

export function sessionContext({ slug, session, todayItems, previous, otherOpen, cli }) {
  const history = [];
  if (todayItems.length) history.push('Recorded today:', ...todayItems.map(itemLine));
  const unfinished = previous?.items.filter((i) => i.status === 'partial') ?? [];
  if (unfinished.length) history.push(`Unfinished from ${previous.date}:`, ...unfinished.map(itemLine));
  if (otherOpen) history.push(`${otherOpen} other session(s) today have no recorded end (still open, or ended unexpectedly).`);
  const shown =
    history.length > CONTEXT_LIMIT
      ? [...history.slice(0, CONTEXT_LIMIT - 1), `… ${history.length - CONTEXT_LIMIT + 1} more lines: ${cli} journal:show --project ${slug}`]
      : history;
  return [
    `opflow journal — project "${slug}", session ${session}.`,
    ...shown,
    'When you finish or partly build a feature, or fix a bug, record it once (local journal only; no approval needed):',
    `${cli} journal:note --session ${session} --kind feature|bug --status done|partial --text "<one line>" [--ticket <id>]`,
    'Commit first when you can: the newest commit of this session that no note uses yet is attached automatically. If you note before committing, note the same item again after the commit.',
  ].join('\n');
}
