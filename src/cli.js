import { homedir } from 'node:os';
import { join } from 'node:path';
import { DONE_STATUS, TYPE_NAME, currentSprint, findByName } from './openproject.js';
import { HOURS_PER_POINT, allocate, durationToHours, validateTasks, workPackageCreateBody } from './payloads.js';
import { formatGroups, groupByStatus, summarize } from './report.js';
import { validateMessage } from './talk.js';

export { DONE_STATUS, TYPE_NAME };
export const SPRINT_POINTS = 60;

export const USAGE = `Usage: opflow <command> [options]

Commands:
  setup [--keep-preferences]     Set up credentials, ticket breakdown and report template (interactive)
  plan:rules                     Print your /opflow:plan-feature ticket-breakdown rules
  check                          Verify OpenProject and Nextcloud Talk access (read-only)
  op:create --file tasks.json    Create User Stories in the current sprint or backlog (dry run unless --yes)
  op:done <id...>                Set work packages to Closed (dry run unless --yes)
  op:today [--json]              List your work packages updated today
  talk:post --file report.md     Post a message to the Talk room (dry run unless --yes)
  journal:note --kind feature|bug --status done|partial --text "..." [--ticket <id>] [--commit <hash>] [--session <id>]
                                 Record a feature or bug fix in this project's journal (local only)
  journal:show [--project <slug>] [--date YYYY-MM-DD] [--json]
                                 Show the journal (default: all projects, today)`;

// PowerShell doesn't expand ~ for native programs, so skills' ~/.opflow/... paths are expanded here.
function expandHome(path) {
  return path && /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, yes: false, json: false, file: null, ids: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--file') opts.file = expandHome(rest[++i] ?? null);
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`);
    else opts.ids.push(arg);
  }
  return opts;
}

function requireFile(opts) {
  if (!opts.file) throw new Error('--file <path> is required');
  return opts.file;
}

function stripBOM(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const NO_BACKLOG = 'Not created (sprint is full, no backlog set)';

async function check(_opts, { op, talk, log, backlog }) {
  let ok = true;
  const step = async (label, fn) => {
    try {
      log(`OK    ${label}: ${await fn()}`);
    } catch (err) {
      ok = false;
      log(`FAIL  ${label}: ${err.message}`);
    }
  };
  await step('OpenProject user', async () => (await op.me()).name);
  await step('OpenProject project', async () => (await op.project()).name);
  await step(`Type "${TYPE_NAME}"`, async () => `id ${(await op.resolveType(TYPE_NAME)).id}`);
  await step(`Status "${DONE_STATUS}"`, async () => `id ${(await op.resolveStatus(DONE_STATUS)).id}`);
  const versions = op.listVersions();
  await step('Current sprint', async () => {
    const sprint = currentSprint(await versions);
    return `${sprint.name} (id ${sprint.id})`;
  });
  if (backlog) {
    await step('Backlog version', async () => {
      const version = findByName(await versions, backlog, 'Version');
      return `${version.name} (id ${version.id})`;
    });
  } else {
    log("SKIP  Backlog version: not set (overflow stories won't be created)");
  }
  await step('Talk room', async () => (await talk.roomInfo()).displayName);
  return ok ? 0 : 1;
}

async function planSprint(tasks, { op, backlog: backlogName }) {
  const versions = await op.listVersions();
  const sprint = currentSprint(versions);
  const backlog = backlogName ? findByName(versions, backlogName, 'Version') : null;
  const existingHours = (await op.listMyOpenInVersion(sprint.id)).reduce((sum, wp) => sum + durationToHours(wp.estimatedTime), 0);
  // round to whole minutes first so float noise in summed durations can't add a point
  const existing = Math.ceil(Math.round(existingHours * 60) / 60 / HOURS_PER_POINT);
  const split = allocate(tasks, Math.max(0, SPRINT_POINTS - existing));
  const inSprint = new Set(split.sprint);
  return {
    sprint,
    backlog,
    existing,
    split,
    // Without a backlog, stories that don't fit are left out rather than created somewhere unexpected.
    items: tasks.map((task) => ({ task, version: inSprint.has(task) ? sprint : backlog })).filter((item) => item.version),
    skipped: backlog ? [] : split.backlog,
  };
}

function planSummary({ sprint, backlog, existing, split }) {
  const list = (tasks) => tasks.map((t) => `  ${t.subject} (${t.points} pts)`);
  const added = split.sprint.reduce((sum, t) => sum + t.points, 0);
  return [
    `${sprint.name}: ${existing} existing + ${added} new = ${existing + added}/${SPRINT_POINTS} points`,
    ...list(split.sprint),
    ...(backlog
      ? [`${backlog.name}: ${split.backlog.length ? `${split.backlog.length} task(s)` : 'none'}`]
      : split.backlog.length
        ? [`${NO_BACKLOG}: ${split.backlog.length} task(s)`]
        : []),
    ...list(split.backlog),
  ];
}

async function opCreate(opts, deps) {
  const { op, readFile, log, removeFile } = deps;
  const file = requireFile(opts);
  const tasks = validateTasks(JSON.parse(stripBOM(await readFile(file))));
  const [me, type] = await Promise.all([op.me(), op.resolveType(TYPE_NAME)]);
  const plan = await planSprint(tasks, deps);
  const idsFor = (version) => ({ typeId: type.id, assigneeId: me.id, versionId: version.id });

  if (!opts.yes) {
    log(`DRY RUN: ${plan.items.length} ${TYPE_NAME}(s) would be created and assigned to ${me.name}. Re-run with --yes to create.`);
    planSummary(plan).forEach((line) => log(line));
    log(JSON.stringify(plan.items.map(({ task, version }) => workPackageCreateBody(task, idsFor(version))), null, 2));
    return 0;
  }

  const created = [];
  for (const [i, { task, version }] of plan.items.entries()) {
    try {
      const wp = await op.createWorkPackage(task, idsFor(version));
      created.push(wp);
      log(`#${wp.id} ${wp.subject} -> ${version.name}`);
    } catch (err) {
      log(`FAILED on "${task.subject}": ${err.message}`);
      log(`Created before failure: ${created.map((wp) => `#${wp.id}`).join(', ') || 'none'}`);
      log(`Not created: ${plan.items.slice(i).map((item) => item.task.subject).join(' | ')}`);
      return 1;
    }
  }
  if (plan.skipped.length) log(`${NO_BACKLOG}: ${plan.skipped.map((t) => t.subject).join(' | ')}`);
  await removeFile(file);
  log(`Removed ${file}.`);
  return 0;
}

async function opDone(opts, { op, log }) {
  if (!opts.ids.length) throw new Error('Give at least one work package id');
  const bad = opts.ids.filter((id) => !/^\d+$/.test(id));
  if (bad.length) throw new Error(`Invalid work package id(s): ${bad.join(', ')}`);

  if (!opts.yes) {
    log(`DRY RUN: these would be set to ${DONE_STATUS}. Re-run with --yes to apply.`);
    for (const id of opts.ids) {
      const wp = await op.getWorkPackage(id);
      log(`#${wp.id} ${wp.subject} [${wp._links?.status?.title ?? 'Unknown'}]`);
    }
    return 0;
  }

  const status = await op.resolveStatus(DONE_STATUS);
  let failed = 0;
  for (const id of opts.ids) {
    try {
      const wp = await op.closeWorkPackage(id, status.id);
      log(`#${wp.id} ${wp.subject} -> ${DONE_STATUS}`);
    } catch (err) {
      failed++;
      log(`FAILED #${id}: ${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

async function opToday(opts, { op, log, today }) {
  const items = (await op.listUpdatedToday(today)).map(summarize);
  log(opts.json ? JSON.stringify(items, null, 2) : formatGroups(groupByStatus(items)));
  return 0;
}

async function talkPost(opts, { talk, readFile, log, removeFile }) {
  const file = requireFile(opts);
  const message = validateMessage(await readFile(file));
  if (!opts.yes) {
    log('DRY RUN: this message would be posted. Re-run with --yes to post.');
    log('---');
    log(message);
    return 0;
  }
  const posted = await talk.postMessage(message);
  log(`Posted to Talk (message id ${posted.id}).`);
  await removeFile(file);
  log(`Removed ${file}.`);
  return 0;
}

const COMMANDS = {
  check,
  'op:create': opCreate,
  'op:done': opDone,
  'op:today': opToday,
  'talk:post': talkPost,
};

export async function run(argv, deps) {
  try {
    const opts = parseArgs(argv);
    const command = COMMANDS[opts.command];
    if (!command) {
      deps.log(USAGE);
      return 1;
    }
    return await command(opts, deps);
  } catch (err) {
    deps.log(`Error: ${err.message}`);
    return 1;
  }
}
