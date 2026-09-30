import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const toPosix = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');

// fileURLToPath on a POSIX host keeps the leading slash of a Windows drive path
// (/C:/…); drop it so a drive-letter path compares the same regardless of host.
const fileUrlPath = (moduleUrl) => toPosix(fileURLToPath(moduleUrl)).replace(/^\/([a-zA-Z]:)/, '$1');

export function isMainModule(argvPath, moduleUrl, plat = platform()) {
  if (!argvPath) return false;
  const a = toPosix(argvPath);
  const b = fileUrlPath(moduleUrl);
  return plat === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
