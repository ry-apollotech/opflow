import { validateTasks, workPackageCreateBody } from './payloads.js';
import { formatGroups, groupByStatus, summarize } from './report.js';
import { validateMessage } from './talk.js';

export const TYPE_NAME = 'User Story';
export const DONE_STATUS = 'Closed';

export const USAGE = `Usage: dfly <command> [options]

Commands:
  check                          Verify OpenProject and Nextcloud Talk access (read-only)
  op:create --file tasks.json    Create User Stories assigned to you (dry run unless --yes)
  op:done <id...>                Set work packages to Closed (dry run unless --yes)
  op:today [--json]              List your work packages updated today
  talk:post --file report.md     Post a message to the Talk room (dry run unless --yes)`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, yes: false, json: false, file: null, ids: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--file') opts.file = rest[++i] ?? null;
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

async function check(_opts, { op, talk, log }) {
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
  await step('Talk room', async () => (await talk.roomInfo()).displayName);
  return ok ? 0 : 1;
}

async function opCreate(opts, { op, readFile, log, removeFile }) {
  const file = requireFile(opts);
  const tasks = validateTasks(JSON.parse(stripBOM(await readFile(file))));
  const [me, type] = await Promise.all([op.me(), op.resolveType(TYPE_NAME)]);
  const ids = { typeId: type.id, assigneeId: me.id };

  if (!opts.yes) {
    log(`DRY RUN: ${tasks.length} ${TYPE_NAME}(s) would be created and assigned to ${me.name}. Re-run with --yes to create.`);
    log(JSON.stringify(tasks.map((task) => workPackageCreateBody(task, ids)), null, 2));
    return 0;
  }

  const created = [];
  for (const [i, task] of tasks.entries()) {
    try {
      const wp = await op.createWorkPackage(task, ids);
      created.push(wp);
      log(`#${wp.id} ${wp.subject}`);
    } catch (err) {
      log(`FAILED on "${task.subject}": ${err.message}`);
      log(`Created before failure: ${created.map((wp) => `#${wp.id}`).join(', ') || 'none'}`);
      log(`Not created: ${tasks.slice(i).map((t) => t.subject).join(' | ')}`);
      return 1;
    }
  }
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
