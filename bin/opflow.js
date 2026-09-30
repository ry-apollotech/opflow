#!/usr/bin/env node
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run, USAGE } from '../src/cli.js';
import { loadUserConfig, opflowHome, preferencesFile } from '../src/home.js';
import { createOpenProjectClient } from '../src/openproject.js';
import { localDate } from '../src/payloads.js';
import { loadPreferences, planRules } from '../src/preferences.js';
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
    console.error(`setup needs a terminal. Run it in your own terminal:\n  node "${self}" setup`);
    return 1;
  }
  console.error('setup is not available yet');
  return 1;
}

async function main() {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] === 'setup') return setup();
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
