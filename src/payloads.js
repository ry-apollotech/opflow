export const POINTS = [1, 2, 4];
export const HOURS_PER_POINT = 2;

export function workPackageCreateBody({ subject, description, points }, { typeId, assigneeId, versionId }) {
  return {
    subject,
    description: { format: 'markdown', raw: description ?? '' },
    estimatedTime: `PT${points * HOURS_PER_POINT}H`,
    _links: {
      type: { href: `/api/v3/types/${typeId}` },
      assignee: { href: `/api/v3/users/${assigneeId}` },
      version: { href: `/api/v3/versions/${versionId}` },
    },
  };
}

// In priority order: a task joins the sprint if it still fits, otherwise the backlog.
export function allocate(tasks, remainingPoints) {
  const sprint = [];
  const backlog = [];
  let left = remainingPoints;
  for (const task of tasks) {
    if (task.points <= left) {
      sprint.push(task);
      left -= task.points;
    } else {
      backlog.push(task);
    }
  }
  return { sprint, backlog };
}

export function durationToHours(iso) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d = 0, h = 0, min = 0] = m;
  return Number(d) * 24 + Number(h) + Number(min) / 60;
}

export function closeBody(lockVersion, statusId) {
  return { lockVersion, _links: { status: { href: `/api/v3/statuses/${statusId}` } } };
}

const assignedToMe = { assignee: { operator: '=', values: ['me'] } };

export function todayFilters() {
  return JSON.stringify([assignedToMe, { updatedAt: { operator: 't', values: [] } }]);
}

export function todayRangeFilters(date) {
  return JSON.stringify([assignedToMe, { updatedAt: { operator: '<>d', values: [date, date] } }]);
}

export function myOpenInVersionFilters(versionId) {
  return JSON.stringify([
    assignedToMe,
    { status: { operator: 'o', values: [] } },
    { version: { operator: '=', values: [String(versionId)] } },
  ]);
}

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function validateTasks(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('tasks file must be a non-empty JSON array');
  return value.map((task, i) => {
    const label = `Task ${i + 1}`;
    const subject = typeof task?.subject === 'string' ? task.subject.trim() : '';
    if (!subject) throw new Error(`${label}: subject is required`);
    if (subject.length > 255) throw new Error(`${label}: subject is longer than 255 characters`);
    const description = task.description ?? '';
    if (typeof description !== 'string') throw new Error(`${label}: description must be a string`);
    if (!POINTS.includes(task.points)) throw new Error(`${label}: points must be 1, 2 or 4 (split anything bigger than a day)`);
    return { subject, description, points: task.points };
  });
}
