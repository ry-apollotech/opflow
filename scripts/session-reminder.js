// SessionStart hook: reminds Claude that the opflow skills exist without ever running them.
import { existsSync } from 'node:fs';
import { envFile, opflowHome } from '../src/home.js';
import { isMainModule } from '../src/main-module.js';

const NEVER = 'Never run opflow commands or the opflow CLI unless the user types the command themselves.';

export function reminderText({ configured }) {
  if (!configured) {
    return `opflow (OpenProject + Nextcloud Talk) is installed but not set up. Mention once, in one short line at the end of your first reply, that the user can type /opflow:setup to connect their accounts. ${NEVER}`;
  }
  return [
    'opflow (OpenProject + Nextcloud Talk) is available. Mention it once, in one short line at the end of your first reply:',
    'the user can type /opflow:plan-feature <feature> to plan work into the sprint, and /opflow:done-tasks and /opflow:report-day when wrapping up.',
    'If the user later says they are done for the day, you may remind them of /opflow:done-tasks and /opflow:report-day once more.',
    NEVER,
  ].join(' ');
}

export function reminderOutput({ configured }) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reminderText({ configured }) } });
}

if (isMainModule(process.argv[1], import.meta.url)) {
  console.log(reminderOutput({ configured: existsSync(envFile(opflowHome())) }));
}
