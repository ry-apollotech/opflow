export function workPackageCreateBody({ subject, description }, { typeId, assigneeId }) {
  return {
    subject,
    description: { format: 'markdown', raw: description ?? '' },
    _links: {
      type: { href: `/api/v3/types/${typeId}` },
      assignee: { href: `/api/v3/users/${assigneeId}` },
    },
  };
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
    return { subject, description };
  });
}
