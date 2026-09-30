import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseEnv } from './config.js';
import { envFile, preferencesFile, reportTemplateFile } from './home.js';
import { askPreferences, loadPreferences, savePreferences } from './preferences.js';

export const FIELDS = [
  { key: 'OP_URL', label: 'OpenProject URL', hint: 'Browser address bar, e.g. https://openproject.example.com' },
  { key: 'OP_API_KEY', label: 'OpenProject API token', secret: true, hint: 'OpenProject → avatar → My account → Access tokens → API → + API token' },
  { key: 'OP_PROJECT', label: 'OpenProject project identifier', hint: 'The part after /projects/ in the project URL' },
  { key: 'OP_BACKLOG', label: 'Backlog version name', hint: 'OpenProject → project → Backlogs, e.g. Backlog: Android POS' },
  { key: 'NC_URL', label: 'Nextcloud URL', hint: 'Browser address bar, e.g. https://cloud.example.com' },
  { key: 'NC_USER', label: 'Nextcloud username', hint: 'Settings → Personal info (login name, not display name)' },
  { key: 'NC_APP_PASSWORD', label: 'Nextcloud app password', secret: true, hint: 'Settings → Security → Devices & sessions → Create new app password' },
  { key: 'NC_TALK_ROOM', label: 'Talk room token', hint: 'Open the room; the part after /call/ in the URL' },
];

export const ASK_RULES = ['Bash(node *opflow.js*--yes*)', 'PowerShell(node *opflow.js*--yes*)'];

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
      const ask = f.secret ? prompter.askSecret : prompter.ask;
      const value = ((await ask(`${f.label}${shown}: `)) ?? '').trim() || existing;
      if (value) {
        values[f.key] = f.key.endsWith('_URL') ? value.replace(/\/+$/, '') : value;
        break;
      }
      log(`  ${f.label} is required.`);
    }
  }
  return values;
}

export async function runSetup({ home, root, prompter, log, runCheck, keepPreferences = false, migrateFrom = null }) {
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
    await savePreferences(preferencesFile(home), await askPreferences((q) => prompter.ask(q), log));
  }

  if (await copyIfMissing(join(root, 'report-template.example.md'), reportTemplateFile(home))) {
    log(`Created ${reportTemplateFile(home)} (edit it to change your /opflow:report-day format)`);
  }

  log('\nChecking access (read-only):');
  const code = await runCheck();
  log('\nRecommended: add both of these to "permissions.ask" in ~/.claude/settings.json so Claude Code');
  log('asks you again before any opflow write command runs:');
  for (const rule of ASK_RULES) log(`  "${rule}"`);
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
