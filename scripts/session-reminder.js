// SessionStart hook: reminds Claude that the opflow skills exist without ever running them.
import { isMainModule } from '../src/main-module.js';

export const REMINDER = [
  'opflow (OpenProject + Nextcloud Talk) is available. Mention it once, in one short line at the end of your first reply:',
  'the user can type /plan-feature <feature> to plan work into the sprint, and /done-tasks and /report-day when wrapping up.',
  'If the user later says they are done for the day, you may remind them of /done-tasks and /report-day once more.',
  'Never run these commands or the opflow CLI unless the user types the command themselves.',
].join(' ');

export function reminderOutput() {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: REMINDER } });
}

if (isMainModule(process.argv[1], import.meta.url)) {
  console.log(reminderOutput());
}
