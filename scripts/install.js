import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SKILLS_DIR = join(ROOT, 'skills');

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

export function renderSkill(text, { dfly, dataDir }) {
  return text.replaceAll('{{DFLY}}', dfly).replaceAll('{{DATA_DIR}}', dataDir);
}

async function main() {
  const dfly = toPosix(join(ROOT, 'bin', 'dfly.js'));
  const dataDir = toPosix(join(ROOT, '.dfly'));
  const target = join(homedir(), '.claude', 'skills');
  await mkdir(dataDir, { recursive: true });

  for (const name of await readdir(SKILLS_DIR)) {
    const template = await readFile(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const dir = join(target, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), renderSkill(template, { dfly, dataDir }));
    console.log(`Installed /${name} -> ${join(dir, 'SKILL.md')}`);
  }

  console.log('\nAdd this to "permissions.ask" in ~/.claude/settings.json so every write asks first:');
  console.log('  "Bash(node *dfly.js *--yes*)"');
}

if (process.argv[1] && toPosix(process.argv[1]) === toPosix(fileURLToPath(import.meta.url))) {
  await main();
}
