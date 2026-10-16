import { NOTE_KINDS, appendEvent, collapseItems, latestSession, listSlugs, readEvents, unlinkedCommit } from './journal.js';
import { renderDay } from './journal-view.js';
import { identifyProject, runGit, setOpProject } from './project.js';

const STATUSES = ['done', 'partial'];
const MAX_TEXT = 200;

export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'json') {
      flags.json = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    flags[name] = value;
  }
  return flags;
}

function allowOnly(flags, known) {
  const unknown = Object.keys(flags).find((k) => !known.includes(k));
  if (unknown) throw new Error(`Unknown flag: --${unknown}`);
}

function noteFields(flags) {
  allowOnly(flags, ['kind', 'status', 'text', 'ticket', 'commit', 'session']);
  if (!NOTE_KINDS.includes(flags.kind)) throw new Error('--kind must be feature or bug');
  if (!STATUSES.includes(flags.status)) throw new Error('--status must be done or partial');
  const text = String(flags.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('--text is required');
  if (text.length > MAX_TEXT) throw new Error(`--text is longer than ${MAX_TEXT} characters`);
  if (flags.ticket !== undefined && !/^\d+$/.test(flags.ticket)) throw new Error('--ticket must be a work package number');
  if (flags.commit !== undefined && !/^[0-9a-f]{4,40}$/i.test(flags.commit)) throw new Error('--commit must be a commit hash');
  return { kind: flags.kind, status: flags.status, text, ...(flags.ticket ? { ticket: flags.ticket } : {}) };
}

function journalNote(flags, { home, cwd, today, log, git }) {
  const fields = noteFields(flags);
  const project = identifyProject(home, cwd, git);
  const { events } = readEvents(home, project.slug, today);
  const session = flags.session ?? latestSession(events) ?? 'unknown';
  let commit = unlinkedCommit(events, session);
  if (flags.commit !== undefined) {
    commit = git(['rev-parse', '--verify', '--quiet', `${flags.commit}^{commit}`], project.root);
    if (!commit) throw new Error(`Commit ${flags.commit} not found in ${project.root}`);
  }
  appendEvent(home, project.slug, today, { session, source: 'claude', ...fields, ...(commit ? { commit } : {}) });
  log(`Noted in ${project.slug}: ${fields.text} [${fields.status}] (${commit ? `commit ${commit.slice(0, 7)}` : 'not committed'})`);
  return 0;
}

function journalShow(flags, { home, today, log }) {
  allowOnly(flags, ['project', 'date', 'json']);
  const date = flags.date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  if (flags.project !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(flags.project)) throw new Error(`Invalid project: ${flags.project}`);
  const projects = (flags.project ? [flags.project] : listSlugs(home))
    .map((slug) => {
      const { events, skipped } = readEvents(home, slug, date);
      return { slug, items: collapseItems(events), skipped };
    })
    .filter((p) => p.items.length || p.skipped);
  if (flags.json) {
    log(JSON.stringify({ date, projects }, null, 2));
    return 0;
  }
  if (!projects.length) {
    log(`Nothing recorded for ${date}.`);
    return 0;
  }
  log(`# Journal — ${date}`);
  for (const p of projects) {
    log('');
    log(renderDay(p.slug, p.items));
    if (p.skipped) log(`(${p.skipped} unreadable line(s) skipped)`);
  }
  return 0;
}

function projectMap(args, { home, log }) {
  const [slug, target, ...extra] = args;
  if (!slug || !target || extra.length) throw new Error('Usage: project:map <project> <openproject-identifier>|--never');
  if (target !== '--never' && !/^[a-z0-9][a-z0-9_-]*$/i.test(target)) throw new Error(`Invalid OpenProject identifier: ${target}`);
  setOpProject(home, slug, target === '--never' ? false : target);
  log(target === '--never' ? `${slug} will never be ticketed.` : `${slug} -> OpenProject project ${target}`);
  return 0;
}

const COMMANDS = { 'journal:note': journalNote, 'journal:show': journalShow };

export function runJournal(argv, deps) {
  const [command, ...rest] = argv;
  try {
    if (command === 'project:map') return projectMap(rest, deps);
    return COMMANDS[command](parseFlags(rest), { git: runGit, ...deps });
  } catch (err) {
    deps.log(`Error: ${err.message}`);
    return 1;
  }
}
