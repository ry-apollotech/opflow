import { existsSync, readFileSync } from 'node:fs';

export const REQUIRED_KEYS = [
  'OP_URL',
  'OP_API_KEY',
  'OP_PROJECT',
  'NC_URL',
  'NC_USER',
  'NC_APP_PASSWORD',
  'NC_TALK_ROOM',
];

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const trimSlash = (url) => url.replace(/\/+$/, '');

export function buildConfig(env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing config keys: ${missing.join(', ')}`);
  return {
    op: { url: trimSlash(env.OP_URL), apiKey: env.OP_API_KEY, project: env.OP_PROJECT, backlog: env.OP_BACKLOG || null },
    nc: {
      url: trimSlash(env.NC_URL),
      user: env.NC_USER,
      appPassword: env.NC_APP_PASSWORD,
      room: env.NC_TALK_ROOM,
    },
  };
}

export function loadConfig(path, env = process.env) {
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  const overrides = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  return buildConfig({ ...fromFile, ...overrides });
}
