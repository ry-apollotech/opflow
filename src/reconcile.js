import { appendEvent, collapseItems, listSlugs, readEvents } from './journal.js';
import { DONE_STATUS, TYPE_NAME, currentSprint, findByName } from './openproject.js';
import { validateTasks } from './payloads.js';
import { projectBySlug } from './project.js';
import { planSprint } from './sprint.js';

const DESCRIPTION_LIMIT = 1000;

export function ticketSummary(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    status: wp._links?.status?.title ?? 'Unknown',
    type: wp._links?.type?.title ?? 'Unknown',
    version: wp._links?.version?.title ?? null,
    description: (wp.description?.raw ?? '').slice(0, DESCRIPTION_LIMIT),
  };
}

const noteItem = (item) => ({
  note: { ts: item.ts, session: item.session },
  kind: item.kind,
  status: item.status,
  text: item.text,
  commit: item.commit ?? null,
  ticket: item.ticket ?? null,
});

async function ticketIfExists(op, id) {
  try {
    return await op.getWorkPackage(id);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function projectCandidates(slug, opProject, items, { opFor, configuredProject, backlog }) {
  const op = opFor(opProject);
  const versions = await op.listVersions();
  const sprint = currentSprint(versions);
  const backlogVersion = opProject === configuredProject && backlog ? findByName(versions, backlog, 'Version') : null;
  const open = [
    ...(await op.listMyOpenInVersion(sprint.id)),
    ...(backlogVersion ? await op.listMyOpenInVersion(backlogVersion.id) : []),
  ];
  const withMatches = [];
  for (const item of items) {
    const found = [...(item.ticket ? [await ticketIfExists(op, item.ticket)] : []), ...(await op.searchWorkPackages(item.text))];
    const seen = new Set();
    const matches = found.filter((wp) => wp && !seen.has(wp.id) && seen.add(wp.id)).map(ticketSummary);
    withMatches.push({ ...noteItem(item), matches });
  }
  return { slug, opProject, sprint: { id: sprint.id, name: sprint.name }, openTickets: open.map(ticketSummary), items: withMatches };
}

// The day's unlinked journal items per project, with candidate tickets for each mapped project.
export async function reconcileCandidates({ home, date, opFor, configuredProject, backlog }) {
  const projects = [];
  const unmapped = [];
  for (const slug of listSlugs(home)) {
    const items = collapseItems(readEvents(home, slug, date).events).filter((item) => !item.link);
    if (!items.length) continue;
    const opProject = projectBySlug(home, slug)?.opProject ?? null;
    if (opProject === false) continue;
    if (opProject === null) {
      unmapped.push({ slug, items: items.map(noteItem) });
      continue;
    }
    try {
      projects.push(await projectCandidates(slug, opProject, items, { opFor, configuredProject, backlog }));
    } catch (err) {
      projects.push({ slug, opProject, error: err.message });
    }
  }
  return { date, configuredProject, projects, unmapped };
}

const ACTIONS = ['close', 'comment', 'create'];
const NO_BACKLOG = 'not created (sprint is full, no backlog set)';

export function validatePlan(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('reconcile file must be a non-empty JSON array');
  return value.map((a, i) => {
    const label = `Action ${i + 1}`;
    if (!ACTIONS.includes(a?.action)) throw new Error(`${label}: action must be close, comment or create`);
    if (typeof a.project !== 'string' || !a.project) throw new Error(`${label}: project is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')) throw new Error(`${label}: date must be YYYY-MM-DD`);
    if (typeof a.note?.ts !== 'string' || typeof a.note?.session !== 'string') throw new Error(`${label}: note {ts, session} is required`);
    const base = { action: a.action, project: a.project, date: a.date, note: { ts: a.note.ts, session: a.note.session } };
    if (a.action === 'create') {
      let task;
      try {
        [task] = validateTasks([a]);
      } catch (err) {
        throw new Error(err.message.replace(/^Task 1/, label));
      }
      return { ...base, task, closed: a.closed === true };
    }
    if (!/^\d+$/.test(String(a.ticket ?? ''))) throw new Error(`${label}: ticket must be a work package number`);
    if (a.action === 'close') return { ...base, ticket: String(a.ticket) };
    if (typeof a.comment !== 'string' || !a.comment.trim()) throw new Error(`${label}: comment text is required`);
    return { ...base, ticket: String(a.ticket), comment: a.comment.trim() };
  });
}

const closes = (action) => action.action === 'close' || (action.action === 'create' && action.closed);

// Checks one action against the journal as it is now. Throws on anything unsafe; returns a skip for linked notes.
function prepare(home, action, index, seen) {
  const label = `Action ${index + 1} (${action.project})`;
  const key = `${action.project}|${action.date}|${action.note.session}|${action.note.ts}`;
  if (seen.has(key)) throw new Error(`${label}: same note as action ${seen.get(key) + 1}`);
  seen.set(key, index);
  const opProject = projectBySlug(home, action.project)?.opProject;
  if (typeof opProject !== 'string') throw new Error(`${label}: not mapped to an OpenProject project; run project:map`);
  const item = collapseItems(readEvents(home, action.project, action.date).events)
    .find((i) => i.ts === action.note.ts && i.session === action.note.session);
  if (!item) throw new Error(`${label}: note not found, or a newer note replaced it; run reconcile:candidates again`);
  if (item.link) return { action, item, opProject, skip: `already linked to #${item.link.ticket} (${item.link.action})` };
  if (closes(action) && !(item.status === 'done' && item.commit)) {
    throw new Error(`${label}: only done work with a commit can close a ticket ("${item.text}" is ${item.status}${item.commit ? '' : ', not committed'})`);
  }
  return { action, item, opProject };
}

async function projectContext(cache, opProject, opFor) {
  if (!cache.has(opProject)) {
    cache.set(opProject, (async () => {
      const op = opFor(opProject);
      const [me, story, bug, closed, versions] = await Promise.all([
        op.me(), op.resolveType(TYPE_NAME), op.findType('Bug'), op.resolveStatus(DONE_STATUS), op.listVersions(),
      ]);
      return { op, me, types: { feature: story, bug: bug ?? story }, closedId: closed.id, sprint: currentSprint(versions) };
    })());
  }
  return cache.get(opProject);
}

// Version for each create: closed ones go in the current sprint; open ones are placed by points like op:create.
async function placeCreates(prepared, cache, { opFor, project, backlog }) {
  const versions = new Map();
  const open = new Map();
  for (const p of prepared.filter((x) => !x.skip && x.action.action === 'create')) {
    if (p.action.closed) versions.set(p, (await projectContext(cache, p.opProject, opFor)).sprint);
    else open.set(p.opProject, [...(open.get(p.opProject) ?? []), p]);
  }
  for (const [opProject, group] of open) {
    const { op } = await projectContext(cache, opProject, opFor);
    const plan = await planSprint(group.map((p) => p.action.task), { op, backlog: opProject === project ? backlog : null });
    for (const { task, version } of plan.items) versions.set(group.find((p) => p.action.task === task), version);
  }
  return versions;
}

function describe(p, type, version) {
  const { action, item } = p;
  const evidence = item.commit ? ` (commit ${item.commit.slice(0, 7)})` : '';
  if (p.skip) return `skip — ${item.text}: ${p.skip}`;
  if (action.action === 'close') return `close #${action.ticket} — ${item.text}${evidence}`;
  if (action.action === 'comment') return `comment #${action.ticket} — ${item.text}: ${action.comment.replace(/\s+/g, ' ').slice(0, 80)}`;
  if (!version) return `${NO_BACKLOG}: "${action.task.subject}"`;
  return `create ${type.name} "${action.task.subject}" (${action.task.points} pts) -> ${version.name}${action.closed ? ', then Closed' : ''}${evidence}`;
}

async function execute(p, ctx, version, link) {
  const { action } = p;
  if (action.action === 'close') {
    await ctx.op.closeWorkPackage(action.ticket, ctx.closedId);
    return link(action.ticket, 'closed');
  }
  if (action.action === 'comment') {
    await ctx.op.addComment(action.ticket, action.comment);
    return link(action.ticket, 'commented');
  }
  const type = ctx.types[p.item.kind];
  const wp = await ctx.op.createWorkPackage(action.task, { typeId: type.id, assigneeId: ctx.me.id, versionId: version.id });
  link(wp.id, 'created');
  if (action.closed) {
    await ctx.op.closeWorkPackage(wp.id, ctx.closedId);
    link(wp.id, 'created-closed');
  }
}

export async function reconcileApply(opts, deps) {
  const { home, readFile, removeFile, log, opFor } = deps;
  if (!opts.file) throw new Error('--file <path> is required');
  const raw = await readFile(opts.file);
  const actions = validatePlan(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  const seen = new Map();
  const prepared = actions.map((action, i) => prepare(home, action, i, seen));
  const cache = new Map();
  const versions = await placeCreates(prepared, cache, deps);
  const rows = [];
  for (const p of prepared) {
    const ctx = p.skip ? null : await projectContext(cache, p.opProject, opFor);
    const type = ctx?.types[p.item.kind];
    rows.push({ p, ctx, version: versions.get(p), line: describe(p, type, versions.get(p)) });
  }

  if (!opts.yes) log('DRY RUN: nothing is changed. Re-run with --yes to apply.');
  let failed = 0;
  let group = null;
  for (const { p, ctx, version, line } of rows) {
    if (p.action.project !== group) {
      group = p.action.project;
      log(`${group} (OpenProject ${p.opProject}):`);
    }
    const runnable = !p.skip && (p.action.action !== 'create' || version);
    if (!opts.yes || !runnable) {
      log(`  ${line}`);
      continue;
    }
    const link = (ticket, action) =>
      appendEvent(home, p.action.project, p.action.date, {
        session: p.item.session, source: 'cli', kind: 'ticket_link',
        note: { ts: p.item.ts, session: p.item.session }, ticket: String(ticket), action, opProject: p.opProject,
      });
    try {
      await execute(p, ctx, version, link);
      log(`  OK ${line}`);
    } catch (err) {
      failed++;
      log(`  FAILED ${line}: ${err.message}`);
    }
  }
  if (!opts.yes) return 0;
  if (failed) return 1;
  await removeFile(opts.file);
  log(`Removed ${opts.file}.`);
  return 0;
}
