import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SKILLS_DIR = join(ROOT, 'skills');

// Claude Code may run skill commands through either the Bash tool or, on Windows, the
// PowerShell tool, so both need an `ask` rule. Skills invoke dfly as `node "<path>" ... --yes`
// (the path is quoted), so the glob must not require a literal space right after `dfly.js`.
export const ASK_RULES = ['Bash(node *dfly.js*--yes*)', 'PowerShell(node *dfly.js*--yes*)'];

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

export function renderSkill(text, { dfly, dataDir }) {
  return text.replaceAll('{{DFLY}}', dfly).replaceAll('{{DATA_DIR}}', dataDir);
}

export function isMainModule(argvPath, moduleUrl, plat = platform()) {
  if (!argvPath) return false;
  const a = toPosix(argvPath);
  const b = toPosix(fileURLToPath(moduleUrl));
  return plat === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function skillDirNames(entries) {
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function main() {
  const dfly = toPosix(join(ROOT, 'bin', 'dfly.js'));
  const dataDir = toPosix(join(ROOT, '.dfly'));
  const target = join(homedir(), '.claude', 'skills');
  await mkdir(dataDir, { recursive: true });

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const name of skillDirNames(entries)) {
    const template = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const dir = join(target, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), renderSkill(template, { dfly, dataDir }));
    console.log(`Installed /${name} -> ${join(dir, 'SKILL.md')}`);
  }

  console.log('\nManual step: add both of these to "permissions.ask" in ~/.claude/settings.json so every');
  console.log('write asks first, whether Claude Code runs the command with Bash or PowerShell.');
  console.log('This installer only prints them; it does not edit your settings.');
  for (const rule of ASK_RULES) console.log(`  "${rule}"`);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main();
}
