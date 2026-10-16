#!/usr/bin/env node
import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, USAGE } from '../src/cli.js';
import { loadUserConfig, opflowHome, preferencesFile } from '../src/home.js';
import { runJournal } from '../src/journal-cli.js';
import { createOpenProjectClient } from '../src/openproject.js';
import { localDate } from '../src/payloads.js';
import { loadPreferences, planRules } from '../src/preferences.js';
import { createTerminalPrompter, runSetup } from '../src/setup.js';
import { createTalkClient } from '../src/talk.js';

const argv = process.argv.slice(2);
const home = opflowHome();
const self = fileURLToPath(import.meta.url).replaceAll('\\', '/');

export function cliDeps(config) {
  return {
    op: createOpenProjectClient(config.op),
    talk: createTalkClient(config.nc),
    readFile: (path) => readFile(path, 'utf8'),
    removeFile: (path) => unlink(path),
    log: (line) => console.log(line),
    today: localDate(),
    backlog: config.op.backlog,
  };
}

async function setup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `setup needs a terminal. Run it in your own terminal:\n  node "${self}" setup\n` +
        'On Windows, use PowerShell or Windows Terminal (Git Bash/mintty may not count as a terminal).',
    );
    return 1;
  }
  const prompter = createTerminalPrompter(process.stdin, process.stdout);
  try {
    return await runSetup({
      home,
      root: fileURLToPath(new URL('..', import.meta.url)),
      prompter,
      log: (line) => console.log(line),
      runCheck: () => run(['check'], cliDeps(loadUserConfig(home))),
      settingsFile: join(homedir(), '.claude', 'settings.json'),
      keepPreferences: argv.includes('--keep-preferences'),
      migrateFrom: process.env.OPFLOW_MIGRATE_FROM || null,
    });
  } finally {
    prompter.close();
  }
}

async function main() {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] === 'setup') return setup();
  if (['journal:note', 'journal:show', 'project:map'].includes(argv[0])) {
    return runJournal(argv, { home, cwd: process.cwd(), today: localDate(), log: (line) => console.log(line) });
  }
  if (argv[0] === 'plan:rules') {
    console.log(planRules(await loadPreferences(preferencesFile(home))));
    return 0;
  }
  return run(argv, cliDeps(loadUserConfig(home)));
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
