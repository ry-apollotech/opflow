import { collapseItems, listSlugs, readEvents } from './journal.js';
import { currentSprint, findByName } from './openproject.js';
import { projectBySlug } from './project.js';

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
