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

const itemKey = (e) => (e.ticket ? `ticket:${e.ticket}` : `${e.kind}:${e.text.replace(/\s+/g, ' ').trim().toLowerCase()}`);

// One entry per feature/bug: the latest note wins (moved to the end), keeping an earlier commit if it has none.
export function collapseItems(events) {
  const items = new Map();
  for (const e of events) {
    if (!NOTE_KINDS.includes(e.kind) || typeof e.text !== 'string') continue;
    const key = itemKey(e);
    const before = items.get(key);
    items.delete(key);
    items.set(key, before?.commit && !e.commit ? { ...e, commit: before.commit } : e);
  }
  return [...items.values()];
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
