import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const NOTE_KINDS = ['feature', 'bug'];
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export const journalDir = (home) => join(home, 'journal');
export const journalFile = (home, slug, date) => join(journalDir(home), slug, `${date}.jsonl`);

// One appendFileSync per event: concurrent sessions append whole lines, and a crash can't damage earlier ones.
export function appendEvent(home, slug, date, event) {
  mkdirSync(join(journalDir(home), slug), { recursive: true });
  appendFileSync(journalFile(home, slug, date), `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

export function readEvents(home, slug, date) {
  let raw;
  try {
    raw = readFileSync(journalFile(home, slug, date), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], skipped: 0 };
    throw err;
  }
  const events = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === 'object' && typeof event.kind === 'string') events.push(event);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export const listDates = (home, slug) =>
  listDir(join(journalDir(home), slug)).map((f) => DATE_FILE.exec(f.name)?.[1]).filter(Boolean).sort();

export const listSlugs = (home) =>
  listDir(journalDir(home)).filter((f) => f.isDirectory()).map((f) => f.name).sort();

const normText = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// Same item: same ticket, or (unless both have different tickets) same kind and text.
function sameItem(a, b) {
  if (a.ticket && b.ticket) return a.ticket === b.ticket;
  return a.kind === b.kind && normText(a.text) === normText(b.text);
}

const noteRef = (e) => `${e.session}|${e.ts}`;

export function ticketLinks(events) {
  return new Map(events.filter((e) => e.kind === 'ticket_link' && e.note).map((e) => [`${e.note.session}|${e.note.ts}`, e]));
}

// One entry per feature/bug: the latest note wins (moved to the end), keeping an earlier commit or ticket if it has
// none. A note's ticket_link counts as its ticket; `link` is set only when the latest note itself is linked.
export function collapseItems(events) {
  const links = ticketLinks(events);
  const items = [];
  for (const e of events) {
    if (!NOTE_KINDS.includes(e.kind) || typeof e.text !== 'string') continue;
    const link = links.get(noteRef(e));
    const current = link && !e.ticket ? { ...e, ticket: link.ticket } : e;
    const index = items.findIndex((item) => sameItem(item, current));
    const before = index === -1 ? null : items.splice(index, 1)[0];
    items.push({
      ...current,
      ...(before?.commit && !current.commit ? { commit: before.commit } : {}),
      ...(before?.ticket && !current.ticket ? { ticket: before.ticket } : {}),
      ...(link ? { link: { ticket: link.ticket, action: link.action } } : {}),
    });
  }
  return items;
}

export const latestSession = (events) => events.filter((e) => e.kind === 'session_start').at(-1)?.session ?? null;

// The session's newest commit that no note links yet.
export function unlinkedCommit(events, session) {
  const linked = new Set(events.filter((e) => NOTE_KINDS.includes(e.kind) && e.commit).map((e) => e.commit));
  return events.filter((e) => e.kind === 'commit' && e.session === session && !linked.has(e.hash)).at(-1)?.hash ?? null;
}

// The HEAD this session last saw: its latest commit, or the HEAD at session start.
export function knownHead(events, session) {
  return (
    events
      .filter((e) => e.session === session)
      .map((e) => (e.kind === 'commit' ? e.hash : e.kind === 'session_start' ? e.head : undefined))
      .filter(Boolean)
      .at(-1) ?? null
  );
}

export function sessionsWithoutEnd(events, current) {
  const open = new Map();
  for (const e of events) {
    if (e.kind === 'session_start') open.set(e.session, true);
    else if (e.kind === 'session_end') open.set(e.session, false);
  }
  return [...open].filter(([session, isOpen]) => isOpen && session !== current).map(([session]) => session);
}
