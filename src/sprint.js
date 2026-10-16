import { currentSprint, findByName } from './openproject.js';
import { HOURS_PER_POINT, allocate, durationToHours } from './payloads.js';

export const SPRINT_POINTS = 60;

export async function planSprint(tasks, { op, backlog: backlogName }) {
  const versions = await op.listVersions();
  const sprint = currentSprint(versions);
  const backlog = backlogName ? findByName(versions, backlogName, 'Version') : null;
  const existingHours = (await op.listMyOpenInVersion(sprint.id)).reduce((sum, wp) => sum + durationToHours(wp.estimatedTime), 0);
  // round to whole minutes first so float noise in summed durations can't add a point
  const existing = Math.ceil(Math.round(existingHours * 60) / 60 / HOURS_PER_POINT);
  const split = allocate(tasks, Math.max(0, SPRINT_POINTS - existing));
  const inSprint = new Set(split.sprint);
  return {
    sprint,
    backlog,
    existing,
    split,
    // Without a backlog, stories that don't fit are left out rather than created somewhere unexpected.
    items: tasks.map((task) => ({ task, version: inSprint.has(task) ? sprint : backlog })).filter((item) => item.version),
    skipped: backlog ? [] : split.backlog,
  };
}
