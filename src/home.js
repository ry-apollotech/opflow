import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

export const NOT_SET_UP = 'opflow is not set up. Run /opflow:setup in Claude Code.';

export function opflowHome(env = process.env) {
  return env.OPFLOW_HOME || join(homedir(), '.opflow');
}

export const envFile = (home) => join(home, '.env');
export const preferencesFile = (home) => join(home, 'preferences.json');
export const reportTemplateFile = (home) => join(home, 'report-template.md');

export function loadUserConfig(home, env = process.env) {
  if (!existsSync(envFile(home)) && !env.OP_URL) throw new Error(NOT_SET_UP);
  return loadConfig(envFile(home), env);
}
