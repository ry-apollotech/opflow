import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseEnv } from './config.js';
import { envFile, preferencesFile, reportTemplateFile } from './home.js';
import { askPreferences, loadPreferences, savePreferences } from './preferences.js';

export const FIELDS = [
  { key: 'OP_URL', label: 'OpenProject URL', hint: 'Browser address bar, e.g. https://openproject.example.com' },
  { key: 'OP_API_KEY', label: 'OpenProject API token', secret: true, hint: 'OpenProject → avatar → My account → Access tokens → API → + API token' },
  { key: 'OP_PROJECT', label: 'OpenProject project identifier', hint: 'The part after /projects/ in the project URL' },
  { key: 'OP_BACKLOG', label: 'Backlog version name', optional: true, hint: 'OpenProject → project → Backlogs, e.g. Backlog: Android POS. Skip it if you have none: stories that don\'t fit in the sprint are then not created.' },
  { key: 'NC_URL', label: 'Nextcloud URL', hint: 'Browser address bar, e.g. https://cloud.example.com' },
  { key: 'NC_USER', label: 'Nextcloud username', hint: 'Settings → Personal info (login name, not display name)' },
  { key: 'NC_APP_PASSWORD', label: 'Nextcloud app password', secret: true, hint: 'Settings → Security → Devices & sessions → Create new app password' },
  { key: 'NC_TALK_ROOM', label: 'Talk room token', hint: 'Open the room; the part after /call/ in the URL' },
];

export const ASK_RULES = ['Bash(node *opflow.js*--yes*)', 'PowerShell(node *opflow.js*--yes*)'];
export const ALLOW_RULES = ['Bash(node *opflow.js* journal:note*)', 'PowerShell(node *opflow.js* journal:note*)'];

const RULE_SETS = [
  {
    list: 'ask',
    rules: ASK_RULES,
    question: (n, file) => `Make Claude Code ask you before every opflow write (adds ${n} rules to ${file})? [Y/n]: `,
    present: 'Approval rules are already in your Claude Code settings.',
  },
  {
    list: 'allow',
    rules: ALLOW_RULES,
    question: (n, file) => `Let Claude record journal notes without asking each time (adds ${n} rules to ${file})? [Y/n]: `,
    present: 'Journal rules are already in your Claude Code settings.',
  },
];

export const maskSecret = (value) => `****${value.length > 4 ? value.slice(-4) : ''}`;

// parseEnv strips one matching pair of outer quotes, so double-quoting every value round-trips anything.
export function formatEnv(values) {
  const lines = FIELDS.map((f) => `${f.key}="${values[f.key] ?? ''}"`);
  return `# Written by opflow setup. Re-run setup to change these values.\n${lines.join('\n')}\n`;
}

export async function copyIfMissing(source, target) {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

async function readEnv(file) {
  try {
    return parseEnv(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function confirm(prompter, question) {
  const answer = ((await prompter.ask(question)) ?? '').trim().toLowerCase();
  return answer === '' || answer === 'y' || answer === 'yes';
}

async function startingValues(home, root, prompter, migrateFrom) {
  const current = await readEnv(envFile(home));
  if (current) return current;
  for (const file of [migrateFrom, join(root, '.env')].filter(Boolean)) {
    const found = await readEnv(file);
    if (found && (await confirm(prompter, `Found existing settings in ${file}. Use them as starting values? [Y/n]: `))) {
      return found;
    }
  }
  return {};
}

async function promptFields(prompter, current, log) {
  const values = {};
  for (const f of FIELDS) {
    log(`\n${f.label}: ${f.hint}`);
    for (;;) {
      const existing = current[f.key] ?? '';
      const shown = existing ? ` [${f.secret ? maskSecret(existing) : existing}]` : '';
      const note = f.optional ? (existing ? ' (Enter keeps, - removes)' : ' (Enter to skip)') : '';
      const ask = f.secret ? prompter.askSecret : prompter.ask;
      const answer = ((await ask(`${f.label}${shown}${note}: `)) ?? '').trim();
      if (f.optional && (answer === '-' || (!answer && !existing))) {
        values[f.key] = '';
        break;
      }
      const value = answer || existing;
      if (value) {
        values[f.key] = f.key.endsWith('_URL') ? value.replace(/\/+$/, '') : value;
        break;
      }
      log(`  ${f.label} is required.`);
    }
  }
  return values;
}

function printRules(log, { list, rules }) {
  log(`Add both of these to "permissions.${list}" in ~/.claude/settings.json yourself:`);
  for (const rule of rules) log(`  "${rule}"`);
}

// Adds RULE_SETS to Claude Code's permissions after asking about each; writes once, keeps a backup of the
// original, and never touches a file it can't parse.
async function addApprovalRules(settingsFile, prompter, log) {
  let raw = null;
  try {
    raw = await readFile(settingsFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let settings = {};
  try {
    if (raw !== null) settings = JSON.parse(raw);
  } catch {
    settings = null;
  }
  log('');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    log(`Couldn't read ${settingsFile} as JSON, so it was left unchanged.`);
    return RULE_SETS.forEach((set) => printRules(log, set));
  }
  let next = settings;
  for (const set of RULE_SETS) {
    const current = Array.isArray(next.permissions?.[set.list]) ? next.permissions[set.list] : [];
    const missing = set.rules.filter((rule) => !current.includes(rule));
    if (!missing.length) {
      log(set.present);
      continue;
    }
    if (!(await confirm(prompter, set.question(missing.length, settingsFile)))) {
      printRules(log, set);
      continue;
    }
    next = { ...next, permissions: { ...next.permissions, [set.list]: [...current, ...missing] } };
  }
  if (next === settings) return;
  if (raw !== null) await writeFile(`${settingsFile}.opflow-backup`, raw);
  await mkdir(dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
  log(`Updated ${settingsFile}${raw !== null ? ` (backup: ${settingsFile}.opflow-backup)` : ''}.`);
}

export async function runSetup({ home, root, prompter, log, runCheck, settingsFile, keepPreferences = false, migrateFrom = null }) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  log(`opflow setup: your settings are saved in ${home}`);

  const values = await promptFields(prompter, await startingValues(home, root, prompter, migrateFrom), log);
  await writeFile(envFile(home), formatEnv(values), { mode: 0o600 });
  await chmod(envFile(home), 0o600);
  log(`\nSaved ${envFile(home)}`);

  const saved = await loadPreferences(preferencesFile(home));
  if (keepPreferences && saved) {
    log('Keeping your saved ticket-breakdown preferences.');
  } else {
    log('\nHow should /opflow:plan-feature break your work into tickets?');
    await savePreferences(preferencesFile(home), await askPreferences((q) => prompter.ask(q), log, saved));
  }

  if (await copyIfMissing(join(root, 'report-template.example.md'), reportTemplateFile(home))) {
    log(`Created ${reportTemplateFile(home)} (edit it to change your /opflow:report-day format)`);
  }

  log('\nChecking access (read-only):');
  const code = await runCheck();
  await addApprovalRules(settingsFile, prompter, log);
  return code;
}

// Terminal prompter; askSecret hides typed characters. readline echoes through `screen`, which drops
// everything while muted (the promise-based readline has no public hook for this).
export function createTerminalPrompter(input, output) {
  let muted = false;
  const screen = new Writable({
    write(chunk, encoding, done) {
      if (!muted) output.write(chunk, encoding);
      done();
    },
  });
  screen.columns = output.columns;
  const rl = createInterface({ input, output: screen, terminal: true });
  return {
    ask: (question) => rl.question(question),
    async askSecret(question) {
      output.write(question);
      muted = true;
      try {
        return await rl.question('');
      } finally {
        muted = false;
        output.write('\n');
      }
    },
    close: () => rl.close(),
  };
}
