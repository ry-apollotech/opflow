import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, QUESTIONS, askPreferences, loadPreferences, planRules, savePreferences } from '../src/preferences.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SKILLS_DIR = join(ROOT, 'skills');

// Claude Code may run skill commands through either the Bash tool or, on Windows, the
// PowerShell tool, so both need an `ask` rule. Skills invoke opflow as `node "<path>" ... --yes`
// (the path is quoted), so the glob must not require a literal space right after `opflow.js`.
export const ASK_RULES = ['Bash(node *opflow.js*--yes*)', 'PowerShell(node *opflow.js*--yes*)'];

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

export function sessionStartHook(reminderPath) {
  return { matcher: 'startup', hooks: [{ type: 'command', command: `node "${reminderPath}"` }] };
}

export function renderSkill(text, { opflow, dataDir, reportTemplate, planRules }) {
  return text
    .replaceAll('{{OPFLOW}}', opflow)
    .replaceAll('{{DATA_DIR}}', dataDir)
    .replaceAll('{{REPORT_TEMPLATE}}', reportTemplate)
    .replaceAll('{{PLAN_RULES}}', planRules);
}

export function parseInstallArgs(argv) {
  const opts = { reconfigure: false };
  for (const arg of argv) {
    if (arg === '--reconfigure') opts.reconfigure = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return opts;
}

const describe = (prefs) =>
  QUESTIONS.map((q) => `${q.question}: ${q.options.find((o) => o.value === prefs[q.key]).label}`).join(' | ');

// Saved answers win unless --reconfigure; with no terminal to ask in, fall back to the defaults.
async function planningPreferences(file, { reconfigure }) {
  const saved = await loadPreferences(file);
  if (saved && !reconfigure) {
    console.log(`Ticket breakdown (saved): ${describe(saved)}`);
    console.log('  Change it with: npm run install-skills -- --reconfigure');
    return saved;
  }
  let prefs = DEFAULTS;
  if (process.stdin.isTTY) {
    console.log('\nHow should /plan-feature break your work into tickets?');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      prefs = await askPreferences((prompt) => rl.question(prompt), (line) => console.log(line));
    } finally {
      rl.close();
    }
  } else {
    console.log('No terminal to ask in; using the default ticket breakdown.');
  }
  await savePreferences(file, prefs);
  console.log(`\nTicket breakdown: ${describe(prefs)}`);
  return prefs;
}

// Creates target from source only if target doesn't exist yet, so a user's edits survive reinstalls.
export async function copyIfMissing(source, target) {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

// fileURLToPath on a POSIX host keeps the leading slash of a Windows drive path
// (/C:/…); drop it so a drive-letter path compares the same regardless of host.
const fileUrlPath = (moduleUrl) => toPosix(fileURLToPath(moduleUrl)).replace(/^\/([a-zA-Z]:)/, '$1');

export function isMainModule(argvPath, moduleUrl, plat = platform()) {
  if (!argvPath) return false;
  const a = toPosix(argvPath);
  const b = fileUrlPath(moduleUrl);
  return plat === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function skillDirNames(entries) {
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function main(opts) {
  const opflow = toPosix(join(ROOT, 'bin', 'opflow.js'));
  const dataDir = toPosix(join(ROOT, '.opflow'));
  const reportTemplate = toPosix(join(ROOT, 'report-template.md'));
  const target = join(homedir(), '.claude', 'skills');
  await mkdir(dataDir, { recursive: true });
  if (await copyIfMissing(join(ROOT, 'report-template.example.md'), reportTemplate)) {
    console.log(`Created ${reportTemplate} (edit it to change your /report-day format)`);
  } else {
    console.log(`Keeping your ${reportTemplate}`);
  }
  const prefs = await planningPreferences(join(dataDir, 'preferences.json'), opts);

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const name of skillDirNames(entries)) {
    const template = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const dir = join(target, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), renderSkill(template, { opflow, dataDir, reportTemplate, planRules: planRules(prefs) }));
    console.log(`Installed /${name} -> ${join(dir, 'SKILL.md')}`);
  }

  console.log('\nManual step: add both of these to "permissions.ask" in ~/.claude/settings.json so every');
  console.log('write asks first, whether Claude Code runs the command with Bash or PowerShell.');
  console.log('This installer only prints them; it does not edit your settings.');
  for (const rule of ASK_RULES) console.log(`  "${rule}"`);

  const reminder = toPosix(join(ROOT, 'scripts', 'session-reminder.js'));
  console.log('\nOptional: add this to "hooks.SessionStart" in ~/.claude/settings.json for a one-line');
  console.log('reminder of /plan-feature, /done-tasks and /report-day at the start of each new session.');
  console.log(JSON.stringify(sessionStartHook(reminder), null, 2).replace(/^/gm, '  '));
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(parseInstallArgs(process.argv.slice(2)));
}
