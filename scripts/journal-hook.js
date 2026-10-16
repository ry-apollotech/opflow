// Claude Code hook (SessionStart, PostToolUse on Bash/PowerShell, SessionEnd): keeps the session journal and
// gives Claude the project's journal context. Always exits 0; errors go to ~/.opflow/journal/errors.log.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFile, opflowHome } from '../src/home.js';
import { appendEvent, collapseItems, journalDir, knownHead, listDates, readEvents, sessionsWithoutEnd } from '../src/journal.js';
import { sessionContext } from '../src/journal-view.js';
import { isMainModule } from '../src/main-module.js';
import { localDate } from '../src/payloads.js';
import { identifyProject, runGit, toPosix } from '../src/project.js';
import { reminderText } from './session-reminder.js';

export const COMMIT_COMMAND = /\bgit\b[\s\S]*\bcommit\b/;
// HEAD's latest reflog entry when it was moved by a commit: "commit: …", "commit (amend): …", "commit (merge): …".
const COMMIT_REFLOG = /^commit( \([a-z]+\))?:/;

// HEAD, branch and log come from the session's own checkout (a worktree has its own), not the project root.
const checkout = (input, project) => input.cwd ?? project.root;

const sessionStartOutput = (text) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });

function onSessionStart(input, { home, today, configured, pluginRoot, git }, project, session) {
  const { events } = readEvents(home, project.slug, today);
  const head = git(['rev-parse', 'HEAD'], checkout(input, project));
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], checkout(input, project));
  const trigger = input.source ?? 'startup';
  appendEvent(home, project.slug, today, {
    session, source: 'hook', kind: 'session_start', trigger, cwd: toPosix(input.cwd ?? project.root),
    ...(branch ? { branch } : {}), ...(head ? { head } : {}),
  });
  const previousDate = listDates(home, project.slug).filter((d) => d < today).at(-1);
  const context = sessionContext({
    slug: project.slug,
    session,
    todayItems: collapseItems(events),
    previous: previousDate ? { date: previousDate, items: collapseItems(readEvents(home, project.slug, previousDate).events) } : null,
    otherOpen: sessionsWithoutEnd(events, session).length,
    cli: `node "${pluginRoot}/bin/opflow.js"`,
  });
  return sessionStartOutput(trigger === 'startup' ? `${reminderText({ configured })}\n\n${context}` : context);
}

// Records HEAD after a command that looks like a commit, only if a commit moved HEAD since this session last saw it.
function onCommand(input, { home, today, git }, project, session) {
  const cwd = checkout(input, project);
  const hash = git(['rev-parse', 'HEAD'], cwd);
  if (!hash || !COMMIT_REFLOG.test(git(['reflog', '-1', '--format=%gs'], cwd) ?? '')) return '';
  const { events } = readEvents(home, project.slug, today);
  if (knownHead(events, session) === hash || events.some((e) => e.kind === 'commit' && e.hash === hash)) return '';
  const subject = git(['log', '-1', '--format=%s'], cwd) ?? '';
  appendEvent(home, project.slug, today, { session, source: 'hook', kind: 'commit', hash, subject });
  return '';
}

function onSessionEnd(input, { home, today, git }, project, session) {
  const head = git(['rev-parse', 'HEAD'], checkout(input, project));
  appendEvent(home, project.slug, today, { session, source: 'hook', kind: 'session_end', reason: input.reason ?? 'other', ...(head ? { head } : {}) });
  return '';
}

export function handleHook(input, deps) {
  const ctx = { git: runGit, ...deps };
  const event = input.hook_event_name;
  if (event === 'PostToolUse' && !COMMIT_COMMAND.test(input.tool_input?.command ?? '')) return '';
  if (!['SessionStart', 'PostToolUse', 'SessionEnd'].includes(event)) return '';
  const project = identifyProject(ctx.home, input.cwd ?? process.cwd(), ctx.git);
  const session = input.session_id ?? 'unknown';
  if (event === 'SessionStart') return onSessionStart(input, ctx, project, session);
  if (event === 'PostToolUse') return onCommand(input, ctx, project, session);
  return onSessionEnd(input, ctx, project, session);
}

function logError(home, err) {
  try {
    mkdirSync(journalDir(home), { recursive: true });
    appendFileSync(join(journalDir(home), 'errors.log'), `${new Date().toISOString()} ${err?.stack ?? err}\n`);
  } catch {
    // Nowhere to log; the session must carry on regardless.
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const home = opflowHome();
  const configured = existsSync(envFile(home));
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    const out = handleHook(input, { home, today: localDate(), configured, pluginRoot: toPosix(fileURLToPath(new URL('..', import.meta.url))) });
    if (out) process.stdout.write(`${out}\n`);
  } catch (err) {
    logError(home, err);
    if (input?.hook_event_name === 'SessionStart' && (input.source ?? 'startup') === 'startup') {
      process.stdout.write(`${sessionStartOutput(reminderText({ configured }))}\n`);
    }
  }
  process.exitCode = 0;
}
