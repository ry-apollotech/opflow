#!/usr/bin/env node
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run, USAGE } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { createOpenProjectClient } from '../src/openproject.js';
import { localDate } from '../src/payloads.js';
import { createTalkClient } from '../src/talk.js';

const argv = process.argv.slice(2);

if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
  console.log(USAGE);
} else {
  try {
    const config = loadConfig(fileURLToPath(new URL('../.env', import.meta.url)));
    process.exitCode = await run(argv, {
      op: createOpenProjectClient(config.op),
      talk: createTalkClient(config.nc),
      readFile: (path) => readFile(path, 'utf8'),
      removeFile: (path) => unlink(path),
      log: (line) => console.log(line),
      today: localDate(),
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
